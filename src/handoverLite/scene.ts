import { installActors } from './actors.js';
import { castContact, type CastId } from './cast';
import { prepareSeat } from './seated';
import { prepareAccessories, type AccessoryHead, type CastAccessorySettings } from './accessories';

export interface ActorScene {
  drawResident(ctx: CanvasRenderingContext2D, seconds: number): unknown;
  drawGuest(ctx: CanvasRenderingContext2D, seconds: number): unknown;
  paintCats(ctx: CanvasRenderingContext2D, seconds: number): void;
  dispose(): void;
}

const urls = import.meta.glob<string>('./art/**/*.{webp,json,png}', {
  eager: true, import: 'default', query: '?url',
});

function url(name: string) {
  const asset = urls['./art/' + name];
  if (!asset) throw new Error('Missing handover asset ' + name);
  return asset;
}

type DrawActorFn = (
  ctx: CanvasRenderingContext2D,
  seconds: number,
  behind?: (head: AccessoryHead) => void,
) => { pose: string; head?: AccessoryHead } | undefined;

type PreparedSeat = Awaited<ReturnType<typeof prepareSeat>>;
type DrawGearFn = Awaited<ReturnType<typeof prepareAccessories>>;

// Short-lived LRU warm cache so repeated skin switches feel instant (<5ms)
// while automatically reclaiming 100% of decoded bitmaps after 35s idle.
const WARM_IDLE_TTL_MS = 35_000;
const MAX_WARM_RESIDENTS = 2;
const MAX_WARM_GUESTS = 2;
const MAX_WARM_SEATS = 3;

const warmImages = new Map<string, Promise<HTMLImageElement>>();
const warmData = new Map<string, Promise<unknown>>();
const warmSeats = new Map<CastId, Promise<PreparedSeat>>();
const warmResidents = new Map<CastId, Promise<DrawActorFn>>();
const warmGuests = new Map<CastId, Promise<DrawActorFn>>();
let warmGear: DrawGearFn | undefined;
let warmGearReady: Promise<void> | undefined;
let activeScenes = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function cancelWarmFlush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function flushHandoverWarmCache(): void {
  cancelWarmFlush();
  for (const p of warmImages.values()) {
    void p.then((img) => { img.src = ''; }).catch(() => {});
  }
  warmImages.clear();
  warmData.clear();
  for (const sp of warmSeats.values()) {
    void sp.then((s) => {
      s.body.width = s.body.height = 1;
      s.rest.width = s.rest.height = 1;
    }).catch(() => {});
  }
  warmSeats.clear();
  warmResidents.clear();
  warmGuests.clear();
  warmGear = undefined;
  warmGearReady = undefined;
}

function scheduleWarmFlush(): void {
  cancelWarmFlush();
  if (activeScenes > 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (activeScenes === 0) {
      flushHandoverWarmCache();
    }
  }, WARM_IDLE_TTL_MS);
}

function evictOldest<K, V>(map: Map<K, V>, max: number, onEvict?: (val: V) => void): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    const val = map.get(oldest);
    map.delete(oldest);
    if (val !== undefined) onEvict?.(val);
  }
}

function touchLru<K, V>(map: Map<K, V>, key: K, val: V): void {
  map.delete(key);
  map.set(key, val);
}

function loadSharedImage(name: string): Promise<HTMLImageElement> {
  let ready = warmImages.get(name);
  if (!ready) {
    const image = new Image();
    image.src = url(name);
    ready = image.decode().then(() => image).catch((err) => {
      if (warmImages.get(name) === ready) warmImages.delete(name);
      throw err;
    });
    warmImages.set(name, ready);
  }
  return ready;
}

function loadSharedData(name: string): Promise<any> {
  let ready = warmData.get(name);
  if (!ready) {
    ready = fetch(url(name))
      .then((response) => {
        if (!response.ok) throw new Error('Unavailable handover data ' + name);
        return response.json();
      })
      .catch((err) => {
        if (warmData.get(name) === ready) warmData.delete(name);
        throw err;
      });
    warmData.set(name, ready);
  }
  return ready;
}

function getSharedSeat(id: CastId): Promise<PreparedSeat> {
  let ready = warmSeats.get(id);
  if (ready) {
    touchLru(warmSeats, id, ready);
    return ready;
  }
  ready = prepareSeat(id, loadSharedImage, loadSharedData('seats/layout.json')).catch((err) => {
    if (warmSeats.get(id) === ready) warmSeats.delete(id);
    throw err;
  });
  warmSeats.set(id, ready);
  evictOldest(warmSeats, MAX_WARM_SEATS, (sp) => {
    void sp.then((s) => {
      s.body.width = s.body.height = 1;
      s.rest.width = s.rest.height = 1;
    }).catch(() => {});
  });
  return ready;
}

function getSharedResident(id: CastId): Promise<DrawActorFn> {
  let ready = warmResidents.get(id);
  if (ready) {
    touchLru(warmResidents, id, ready);
    return ready;
  }
  ready = (async () => {
    if (id === 'siamese') {
      const actors = installActors(
        (path) => (path === 'base/siamese.webp' ? getSharedSeat('siamese').then((s) => s.rest) : loadSharedImage(path)),
        loadSharedData,
      );
      await actors.prepareResident();
      return actors.drawResident as DrawActorFn;
    }
    const [{ prepareCastResident }, native] = await Promise.all([
      import('./castResident.js'),
      getSharedSeat(id),
    ]);
    return (await prepareCastResident(id, loadSharedImage, loadSharedData, native.rest)) as DrawActorFn;
  })().catch((err) => {
    if (warmResidents.get(id) === ready) warmResidents.delete(id);
    throw err;
  });
  warmResidents.set(id, ready);
  evictOldest(warmResidents, MAX_WARM_RESIDENTS);
  return ready;
}

function getSharedGuest(id: CastId): Promise<DrawActorFn> {
  let ready = warmGuests.get(id);
  if (ready) {
    touchLru(warmGuests, id, ready);
    return ready;
  }
  ready = (async () => {
    if (id === 'black') {
      const actors = installActors(
        (path) => (path === 'base/black.webp' ? getSharedSeat('black').then((s) => s.rest) : loadSharedImage(path)),
        loadSharedData,
      );
      await actors.prepareGuest();
      return actors.drawGuest as DrawActorFn;
    }
    const [{ prepareCastGuest }, native] = await Promise.all([
      import('./castGuest.js'),
      getSharedSeat(id),
    ]);
    return (await prepareCastGuest(id, loadSharedImage, loadSharedData, native.body, native.rest)) as DrawActorFn;
  })().catch((err) => {
    if (warmGuests.get(id) === ready) warmGuests.delete(id);
    throw err;
  });
  warmGuests.set(id, ready);
  evictOldest(warmGuests, MAX_WARM_GUESTS);
  return ready;
}

function loadSharedGear(): Promise<void> {
  return (warmGearReady ??= prepareAccessories(loadSharedImage)
    .then((paint) => {
      warmGear = paint;
    })
    .catch((err) => {
      warmGearReady = undefined;
      throw err;
    }));
}

/** Prepares a handover scene backed by a short-lived warm cache that auto-flushes when idle. */
export async function prepareActorScene(
  from: CastId,
  to: CastId,
  accessories?: () => CastAccessorySettings,
): Promise<ActorScene> {
  cancelWarmFlush();
  activeScenes++;
  let released = false;

  function activeGear() {
    const gear = accessories?.();
    return gear && (gear.headphones || gear.collar !== 'none') ? gear : undefined;
  }

  let drawResidentPose: DrawActorFn;
  let drawGuest: DrawActorFn;
  let opening: PreparedSeat;
  try {
    [drawResidentPose, drawGuest, opening] = await Promise.all([
      getSharedResident(from),
      getSharedGuest(to),
      getSharedSeat(from),
      activeGear() ? loadSharedGear() : undefined,
    ]);
  } catch (err) {
    activeScenes = Math.max(0, activeScenes - 1);
    scheduleWarmFlush();
    throw err;
  }

  function drawResident(ctx: CanvasRenderingContext2D, seconds: number, behind?: (head: AccessoryHead) => void) {
    const pose = drawResidentPose(ctx, seconds, behind);
    const lift = (seconds - castContact) / .06;
    if (lift > 0 && lift < 1) opening.drawLiftingPaw(ctx, lift);
    return pose;
  }

  function paintActor(
    ctx: CanvasRenderingContext2D,
    time: number,
    draw: DrawActorFn,
    gear?: CastAccessorySettings,
  ) {
    ctx.save();
    const paintGear = warmGear;
    if (paintGear && gear) {
      const behind = gear.headphones ? (head: AccessoryHead) => paintGear(ctx, head, gear, true) : undefined;
      const head = draw(ctx, time, behind)?.head;
      if (head) paintGear(ctx, head, gear);
    } else {
      draw(ctx, time);
    }
    ctx.restore();
  }

  return {
    drawResident,
    drawGuest,
    paintCats(ctx, seconds) {
      const gear = activeGear();
      // Auto headphones may turn on after the bare actors have started moving.
      if (gear && !warmGearReady) void loadSharedGear().catch(() => {});
      paintActor(ctx, seconds, drawResident, gear);
      paintActor(ctx, seconds, drawGuest, gear);
    },
    dispose() {
      if (released) return;
      released = true;
      activeScenes = Math.max(0, activeScenes - 1);
      scheduleWarmFlush();
    },
  };
}
