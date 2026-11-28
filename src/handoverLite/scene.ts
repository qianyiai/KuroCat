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

/** The image cache belongs to one performance so cancelled and finished actors can be collected. */
export async function prepareActorScene(from: CastId, to: CastId, accessories?: () => CastAccessorySettings): Promise<ActorScene> {
  const images = new Map<string, Promise<HTMLImageElement>>();
  function loadImage(name: string) {
    let ready = images.get(name);
    if (!ready) {
      const image = new Image();
      image.src = url(name);
      ready = image.decode().then(() => image);
      images.set(name, ready);
    }
    return ready;
  }
  async function loadData(name: string) {
    const response = await fetch(url(name));
    if (!response.ok) throw new Error('Unavailable handover data ' + name);
    return response.json();
  }
  const seats = new Map<CastId, ReturnType<typeof prepareSeat>>();
  let seatLayout: ReturnType<typeof loadData> | undefined;
  function seat(id: CastId) {
    let ready = seats.get(id);
    if (!ready) {
      seatLayout ??= loadData('seats/layout.json');
      ready = prepareSeat(id, loadImage, seatLayout);
      seats.set(id, ready);
    }
    return ready;
  }
  const actors = installActors(path => {
    if (path === 'base/black.webp') return seat(to).then(s => s.rest);
    if (path === 'base/siamese.webp') return seat(from).then(s => s.rest);
    return loadImage(path);
  }, loadData);
  async function resident() {
    if (from === 'siamese') { await actors.prepareResident(); return actors.drawResident; }
    const [{ prepareCastResident }, native] = await Promise.all([import('./castResident.js'), seat(from)]);
    return prepareCastResident(from, loadImage, loadData, native.rest);
  }
  async function guest() {
    if (to === 'black') { await actors.prepareGuest(); return actors.drawGuest; }
    const [{ prepareCastGuest }, native] = await Promise.all([import('./castGuest.js'), seat(to)]);
    return prepareCastGuest(to, loadImage, loadData, native.body, native.rest);
  }
  let drawGear: Awaited<ReturnType<typeof prepareAccessories>> | undefined;
  let gearReady: Promise<void> | undefined;
  function activeGear() {
    const gear = accessories?.();
    return gear && (gear.headphones || gear.collar !== 'none') ? gear : undefined;
  }
  function loadGear() {
    return gearReady ??= prepareAccessories(loadImage).then(paint => { drawGear = paint; });
  }
  const [drawResidentPose, drawGuest, opening] = await Promise.all([
    resident(), guest(), seat(from), activeGear() && loadGear(),
  ]);
  function drawResident(ctx: CanvasRenderingContext2D, seconds: number, behind?: (head: AccessoryHead) => void) {
    const pose = drawResidentPose(ctx, seconds, behind);
    const lift = (seconds - castContact) / .06;
    if (lift > 0 && lift < 1) opening.drawLiftingPaw(ctx, lift);
    return pose;
  }
  function paintActor(ctx: CanvasRenderingContext2D, time: number,
    draw: (ctx: CanvasRenderingContext2D, t: number, behind?: (head: AccessoryHead) => void) => {pose: string; head?: AccessoryHead} | undefined,
    gear?: CastAccessorySettings) {
    ctx.save();
    const paintGear = drawGear;
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
    drawResident, drawGuest,
    paintCats(ctx, seconds) {
      const gear = activeGear();
      // Auto headphones may turn on after the bare actors have started moving.
      if (gear && !gearReady) void loadGear().catch(() => {});
      paintActor(ctx, seconds, drawResident, gear);
      paintActor(ctx, seconds, drawGuest, gear);
    },
    dispose() {
      for (const p of images.values()) {
        void p.then((img) => { img.src = ''; }).catch(() => {});
      }
      images.clear();
      for (const sp of seats.values()) {
        void sp.then((s) => {
          s.body.width = s.body.height = 1;
          s.rest.width = s.rest.height = 1;
        }).catch(() => {});
      }
      seats.clear();
      drawGear = undefined;
    },
  };
}
