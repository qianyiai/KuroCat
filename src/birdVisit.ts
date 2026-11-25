import { drawForagingBird, type BirdPose } from './birdSprite';

export const BIRD_STAGE_WIDTH = 720;
export const BIRD_STAGE_HEIGHT = 520;
export const BIRD_STAGE_PET = { x: 90, y: 30, width: 540, height: 456 } as const;

type VisitRoute = 'glide' | 'bounce' | 'sweep';
type PerchDetail = 'tilt' | 'peck' | 'blink';
type FarewellKind = 'groom' | 'shuffle' | 'dash';
type FarewellMove = 'wipe' | 'ruffle' | 'look' | 'walk' | 'skip' | 'launch';
type Movement = 'none' | 'arrival' | 'perch' | 'hop' | 'walk' | 'peck' | 'look' | 'wipe' | 'ruffle' | 'launch' | 'flight';
type Random = () => number;

export type BirdVisitKind = 'typing' | 'sleep';

interface Point {
  x: number;
  y: number;
}

interface Grain extends Point {
  size: number;
  angle: number;
}

interface FoodSpot extends Point {
  facesRight: boolean;
  grains: Grain[];
  count: number;
  pause: number;
}

interface TrailStop extends FoodSpot {
  from: Point;
  startAt: number;
  arrival: number;
  distance: number;
  end: number;
  facesWhileWalking: boolean;
}

interface FarewellStep {
  kind: FarewellMove;
  start: Point;
  end: Point;
  from: number;
  to: number;
  facesRight: boolean;
}

interface Farewell {
  steps: FarewellStep[];
  departAt: number;
}

type MovingPose = BirdPose & { shadowY: number; facesRight: boolean; movement: Movement };

export interface BirdVariation {
  route: VisitRoute;
  detail: PerchDetail;
  farewellKind: FarewellKind;
}

interface VisitPlan extends BirdVariation {
  kind: BirdVisitKind;
  from: Point;
  landing: Point;
  perch: Point;
  left: boolean;
  entryStart: number;
  settleAt: number;
  patience: number;
}

interface ForagingPlan extends VisitPlan {
  start: Point;
  stepOffAt: number;
  deskAt: number;
  trail: TrailStop[];
  farewell: Farewell;
}

interface StartledBird {
  startAt: number;
  takeoff: number;
  landingAt: number;
  from: MovingPose;
  to: Point;
  facesRight: boolean;
  trail: TrailStop[];
  farewell: Farewell;
}

export interface BirdVisitFrame {
  pose: BirdPose | null;
  grains: readonly Grain[];
  movement: Movement;
  remaining: number;
}

const ROUTES: readonly VisitRoute[] = ['glide', 'bounce', 'sweep'];
const DETAILS: readonly PerchDetail[] = ['tilt', 'peck', 'blink'];
const FAREWELLS: readonly FarewellKind[] = ['groom', 'shuffle', 'dash'];
const PECK_INTERVAL = 0.36;
const FIRST_PECK = 0.22;
const CONTACT = 0.115;
const MAX_TYPING_GAP = 0.42;

const clamp = (v: number, min = 0, max = 1): number => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const smooth = (u: number): number => u * u * (3 - 2 * u);
const part = (t: number, start: number, end: number): number => clamp((t - start) / (end - start));
const range = (a: number, b: number, random: Random): number => lerp(a, b, random());

function pickDifferent<T>(choices: readonly T[], previous: T | undefined, random: Random): T {
  const available = choices.filter((choice) => choice !== previous);
  return available[Math.floor(random() * available.length)];
}

function chooseVisit(previous: BirdVariation | undefined, random: Random, kind: BirdVisitKind): VisitPlan {
  const route = pickDifferent(ROUTES, previous?.route, random);
  const detail = pickDifferent(DETAILS, previous?.detail, random);
  const entryStart = kind === 'sleep' ? range(0.4, 0.76, random) : range(1.5, 2.02, random);
  const common = {
    kind,
    route,
    detail,
    farewellKind: pickDifferent(FAREWELLS, previous?.farewellKind, random),
    entryStart,
    patience: range(2.05, 3.35, random),
  };
  if (kind === 'sleep') {
    const left = route === 'bounce';
    const deskEdge = {
      x: left ? range(140, 155, random) : range(561, 582, random),
      y: range(374, 389, random),
    };
    const fromX = left ? range(73, 109, random) : range(624, 670, random);
    return {
      ...common, left,
      from: { x: fromX, y: range(169, 217, random) },
      landing: deskEdge, perch: deskEdge,
      settleAt: entryStart + range(0.76, 1.05, random),
    };
  }
  if (route === 'bounce') {
    return {
      ...common, left: true,
      from: { x: range(69, 108, random), y: range(157, 211, random) },
      landing: { x: range(141, 177, random), y: range(352, 378, random) },
      perch: { x: range(220, 241, random), y: range(327, 335, random) },
      settleAt: entryStart + range(1.12, 1.42, random),
    };
  }
  if (route === 'sweep') {
    return {
      ...common, left: false,
      from: { x: range(642, 682, random), y: range(120, 157, random) },
      landing: { x: 571, y: 325 },
      perch: { x: range(459, 485, random), y: range(338, 346, random) },
      settleAt: entryStart + range(1.04, 1.33, random),
    };
  }
  return {
    ...common, left: false,
    from: { x: range(620, 665, random), y: range(151, 203, random) },
    landing: { x: 570, y: 340 },
    perch: { x: range(501, 522, random), y: range(338, 346, random) },
    settleAt: entryStart + range(0.83, 1.08, random),
  };
}

function birdAt(x: number, y: number, facesRight: boolean, movement: Movement, extra: Partial<BirdPose> = {}): MovingPose {
  return { x, y, shadowY: y, facesRight, movement, ...extra };
}

function look(t: number): number {
  const turn = Math.sin(t * 2.1);
  return (Math.abs(turn) > 0.45 ? turn : turn * 0.18) * 0.8;
}

const blink = (t: number): number => Math.max(0, 1 - Math.abs(t % 2.37 - 1.06) / 0.065);

function scheduleTrail(start: Point, startAt: number, spots: readonly FoodSpot[], quiet: boolean): TrailStop[] {
  let from = start;
  let time = startAt;
  return spots.map((spot) => {
    const distance = Math.hypot(spot.x - from.x, spot.y - from.y);
    const arrival = time + clamp(distance / (quiet ? 43 : 58), 0.33, 1.29);
    const next = {
      ...spot, from, startAt: time, arrival, distance,
      end: arrival + FIRST_PECK + spot.count * PECK_INTERVAL + spot.pause,
      facesWhileWalking: spot.x > from.x,
    };
    from = spot;
    time = next.end;
    return next;
  });
}

function scheduleFarewell(
  plan: VisitPlan, trail: readonly TrailStop[], start: Point, startAt: number, random: Random,
): Farewell {
  const { left, farewellKind } = plan;
  const last = trail.at(-1);
  let position = last ?? start;
  let marker = last ? last.end - last.pause : startAt + 0.15;
  const exitRight = !left;
  const away = left ? -1 : 1;
  const steps: FarewellStep[] = [];
  const add = (kind: FarewellMove, duration: number, end: Point, facesRight: boolean): void => {
    steps.push({ kind, start: position, end, from: marker, to: marker + duration, facesRight });
    position = end;
    marker += duration;
  };
  const atTable = (x: number, y: number): Point => ({
    x: clamp(x, left ? 61 : 558, left ? 171 : 672), y: clamp(y, 367, 424),
  });

  switch (farewellKind) {
    case 'groom':
      add('wipe', range(0.49, 0.66, random), position, last?.facesRight ?? exitRight);
      add('ruffle', range(0.34, 0.44, random), position, left);
      add('look', range(0.17, 0.31, random), position, left);
      break;
    case 'shuffle':
      add('walk', range(0.45, 0.71, random),
        atTable(position.x - away * range(28, 41, random), position.y + range(-15, 6, random)), left);
      add('look', range(0.28, 0.48, random), position, left);
      add('skip', range(0.30, 0.42, random),
        atTable(position.x + away * range(24, 40, random), position.y + range(2, 11, random)), exitRight);
      break;
    case 'dash':
      add('ruffle', range(0.32, 0.40, random), position, left);
      add('skip', range(0.30, 0.41, random),
        atTable(position.x + away * range(22, 39, random), position.y + range(5, 12, random)), exitRight);
      add('look', range(0.20, 0.29, random), position, left);
      break;
  }
  add('launch', range(0.14, 0.22, random), position, exitRight);
  return { steps, departAt: marker };
}

function prepareForaging(plan: VisitPlan, random: Random): ForagingPlan {
  const { left } = plan;
  const quiet = plan.kind === 'sleep';
  const anchors = left ? [[112, 127], [79, 96], [135, 154]] : [[594, 610], [642, 654], [571, 594]];
  const start = quiet ? plan.perch : {
    x: left ? range(140, 155, random) : range(561, 582, random), y: range(365, 388, random),
  };
  let previous = start;
  const spots = (quiet ? anchors.slice(0, 1) : anchors).map(([min, max]) => {
    const x = range(min, max, random);
    const y = range(378, quiet ? 397 : 421, random);
    const facesRight = x > previous.x;
    const count = quiet ? 2 : random() > 0.48 ? 3 : 2;
    const grains = Array.from({ length: count }, (_, index) => ({
      x: x + (facesRight ? 36 : -36) + (index - (count - 1) / 2) * 4.4,
      y: y + range(-1, 2, random),
      size: range(1.5, 2.5, random),
      angle: range(-0.6, 0.6, random),
    }));
    previous = { x, y };
    return { x, y, facesRight, grains, count, pause: range(0.19, 0.4, random) };
  });
  const stepOffAt = plan.settleAt + range(0.65, 1.12, random);
  const deskAt = quiet ? stepOffAt : stepOffAt + range(0.36, 0.49, random);
  const trail = scheduleTrail(start, deskAt, spots, quiet);
  return {
    ...plan, start, stepOffAt, deskAt, trail,
    farewell: scheduleFarewell(plan, trail, start, deskAt, random),
  };
}

function hop(from: Point & { shadowY?: number }, to: Point, phase: number, height: number, facesRight: boolean): MovingPose {
  const y = lerp(from.y, to.y, phase);
  const lift = Math.sin(Math.PI * phase) * height;
  return birdAt(lerp(from.x, to.x, smooth(phase)), y - lift, facesRight, 'hop', {
    shadowY: lerp(from.shadowY ?? from.y, to.y, phase), lift,
    wingSpread: Math.sin(Math.PI * phase) * 0.64,
    flutter: Math.sin(phase * Math.PI * 3),
    tilt: Math.sin(Math.PI * phase) * (facesRight ? 0.12 : -0.12),
  });
}

function arrivalPose(t: number, plan: VisitPlan): MovingPose {
  const quiet = plan.kind === 'sleep';
  const bounces = !quiet && plan.route === 'bounce';
  const firstStop = bounces ? plan.settleAt - 0.32 : plan.settleAt;
  const destination = bounces ? plan.landing : plan.perch;
  if (t < firstStop) {
    const p = part(t, plan.entryStart, firstStop);
    const xEase = plan.route === 'sweep'
      ? smooth(p) + 0.1 * Math.sin(2 * Math.PI * p)
      : 1 - (1 - p) ** 1.45;
    const lift = plan.route === 'sweep' ? Math.sin(Math.PI * p) * (quiet ? 14 : 26) : 0;
    const y = lerp(plan.from.y, destination.y, 1 - (1 - p) ** 1.18) - lift;
    return birdAt(lerp(plan.from.x, destination.x, xEase), y, plan.left, 'arrival', {
      shadowY: destination.y,
      lift: Math.max(0, destination.y - y),
      visibility: smooth(clamp((t - plan.entryStart) / 0.135)),
      wingSpread: (quiet ? 0.58 : 0.9) * (1 - smooth(clamp((p - 0.8) / 0.2))),
      flutter: Math.sin(t * (quiet ? 22 : plan.route === 'sweep' ? 28 : 35)),
      tilt: (1 - p) * (quiet ? (plan.left ? 0.10 : -0.10) : (plan.left ? 0.15 : -0.15)),
    });
  }
  const p = part(t, firstStop + 0.043, plan.settleAt);
  return { ...hop(plan.landing, plan.perch, p, 19, plan.left), movement: 'arrival' };
}

function consumed(stop: TrailStop, t: number): number {
  return clamp(1 + Math.floor((t - stop.arrival - FIRST_PECK - CONTACT) / PECK_INTERVAL), 0, stop.count);
}

function trailPose(t: number, trail: readonly TrailStop[], start: Point, facesRight: boolean, quiet: boolean): MovingPose {
  const stop = trail.find((point) => t < point.end);
  if (!stop) {
    const last = trail.at(-1);
    const at = last ?? start;
    return birdAt(at.x, at.y, last?.facesRight ?? facesRight, 'look', { look: look(t), blink: blink(t) });
  }
  if (t < stop.startAt) return birdAt(start.x, start.y, facesRight, 'look', { look: look(t) });
  if (t < stop.arrival) {
    const p = part(t, stop.startAt, stop.arrival);
    const pace = 0.68 * p + 0.32 * smooth(p);
    return birdAt(lerp(stop.from.x, stop.x, pace), lerp(stop.from.y, stop.y, pace), stop.facesWhileWalking, 'walk', {
      walk: Math.min(1, p * 8, (1 - p) * 8) * (quiet ? 0.54 : 1),
      stepPhase: 2 * Math.PI * pace * (quiet ? 1 : Math.max(1.3, stop.distance / 26)),
      look: Math.sin(p * Math.PI) * 0.25,
    });
  }
  const feeding = t - stop.arrival - FIRST_PECK;
  const phase = feeding % PECK_INTERVAL;
  const peck = feeding >= 0 && feeding < stop.count * PECK_INTERVAL
    ? Math.min(smooth(clamp(phase / 0.10)), 1 - smooth(clamp((phase - 0.137) / 0.13)))
    : 0;
  return birdAt(stop.x, stop.y, stop.facesRight, peck > 0.09 ? 'peck' : 'look', {
    peck, look: look(t) * (1 - peck), blink: blink(t) * (1 - peck),
  });
}

function farewellPose(t: number, finish: Farewell): MovingPose {
  const beat = finish.steps.find((step) => t < step.to) ?? finish.steps[finish.steps.length - 1];
  const p = part(t, beat.from, beat.to);
  const fade = Math.sin(p * Math.PI);
  const kind = beat.kind;
  const isWalking = kind === 'walk';
  const isSkipping = kind === 'skip';
  const progress = smooth(p);
  const tabletopY = lerp(beat.start.y, beat.end.y, p);
  const lift = isSkipping ? fade * 16 : 0;
  const yaw = Math.sin(p * 2 * Math.PI);
  return {
    x: lerp(beat.start.x, beat.end.x, progress),
    y: tabletopY - lift,
    shadowY: tabletopY,
    facesRight: beat.facesRight,
    lift,
    movement: kind === 'skip' ? 'hop' : kind,
    peck: kind === 'wipe' ? Math.min(0.92, fade * 1.35) : 0,
    wipe: kind === 'wipe' ? Math.sin(p * Math.PI * 4) * fade : 0,
    blink: kind === 'look' ? Math.max(0, 1 - Math.abs(p - 0.64) * 8) : 0,
    look: kind === 'look' ? fade * 0.93 : 0,
    ruffle: kind === 'ruffle' ? fade * (0.42 + 0.58 * Math.abs(Math.sin(p * 5 * Math.PI))) : 0,
    crouch: kind === 'launch' ? progress * 0.88 : 0,
    walk: isWalking ? Math.min(p * 7, (1 - p) * 7, 1) : 0,
    stepPhase: isWalking ? p * Math.PI * 4 : kind === 'ruffle' ? p * Math.PI * 5 : 0,
    wingSpread: isSkipping ? fade * 0.42 : 0,
    flutter: isSkipping ? yaw : 0,
  };
}

export class BirdVisit {
  public readonly variation: BirdVariation;

  private readonly plan: ForagingPlan;
  private startled: StartledBird | null = null;
  private consecutiveTypingAt = Number.NEGATIVE_INFINITY;
  private lastKeyAt = Number.NEGATIVE_INFINITY;
  private typingDepartureAt = Number.POSITIVE_INFINITY;

  constructor(previous?: BirdVariation, private readonly random: Random = Math.random, kind: BirdVisitKind = 'typing') {
    this.plan = prepareForaging(chooseVisit(previous, random, kind), random);
    const { route, detail, farewellKind } = this.plan;
    this.variation = { route, detail, farewellKind };
  }

  get departure(): { at: number; end: number; cause: 'typing' | 'own' } {
    const own = (this.startled?.farewell ?? this.plan.farewell).departAt;
    const typed = this.typingDepartureAt < own;
    const at = typed ? this.typingDepartureAt : own;
    return { at, end: at + (typed ? 0.76 : this.plan.farewellKind === 'dash' ? 0.64 : 0.90), cause: typed ? 'typing' : 'own' };
  }

  /** Pass a distinct real keystroke with time in seconds since the start of this visit. */
  public onKeyDown(t: number): void {
    if (t < this.plan.settleAt || t >= this.departure.at) return;
    if (!this.startled) this.startle(t);
    if (t - this.lastKeyAt > MAX_TYPING_GAP) this.consecutiveTypingAt = t;
    this.lastKeyAt = t;
    if (t - this.consecutiveTypingAt >= this.plan.patience) this.typingDepartureAt = t;
  }

  public sample(t: number): BirdVisitFrame {
    const departure = this.departure;
    if (t < this.plan.entryStart || t >= departure.end) {
      return { pose: null, movement: 'none', grains: [], remaining: 0 };
    }

    const flying = t >= departure.at;
    const sourceTime = flying ? departure.at : t;
    const shifted = this.startled && sourceTime >= this.startled.startAt;
    const trail = shifted ? this.startled!.trail : this.plan.trail;
    const grains = trail.flatMap((point) => point.grains.slice(consumed(point, sourceTime)));
    let pose = this.walkingPose(sourceTime);
    if (flying) {
      const p = part(t, departure.at, departure.end);
      const left = this.plan.left;
      const rise = Math.sin(p * Math.PI / 2) * (pose.y - 42);
      pose = birdAt(lerp(pose.x, left ? -58 : 778, p ** 1.2), pose.y - rise, !left, 'flight', {
        shadowY: pose.shadowY, lift: rise, wingSpread: smooth(clamp(p / 0.13)) * 0.96,
        flutter: Math.sin(p * Math.PI * (this.plan.farewellKind === 'groom' ? 8 : 11)),
        tilt: (left ? -0.15 : 0.15) * p, crouch: (pose.crouch ?? 0) * (1 - smooth(clamp(p / 0.11))),
      });
    }
    return { pose, grains, movement: pose.movement, remaining: grains.length };
  }

  private startle(t: number): void {
    const { plan, random } = this;
    const from = this.walkingPose(t);
    const facesRight = !plan.left;
    const to = from.shadowY < 356 ? plan.start : {
      x: clamp(from.x + (plan.left ? -1 : 1) * range(21, 42, random), 59, 672),
      y: clamp(from.shadowY + range(-3, 11, random), 365, 422),
    };
    const remaining = plan.trail.flatMap((point) => {
      const eaten = consumed(point, t);
      return eaten < point.count ? [{ ...point, count: point.count - eaten, grains: point.grains.slice(eaten) }] : [];
    });
    const takeoff = t + 0.087;
    const landingAt = takeoff + range(0.33, 0.43, random);
    const trail = scheduleTrail(to, landingAt + 0.19, remaining, plan.kind === 'sleep');
    this.startled = {
      startAt: t, takeoff, landingAt, from, to, facesRight, trail,
      farewell: scheduleFarewell(plan, trail, to, landingAt, random),
    };
  }

  private walkingPose(t: number): MovingPose {
    const { plan, startled } = this;
    const quiet = plan.kind === 'sleep';
    if (startled && t >= startled.startAt) {
      if (t < startled.takeoff) {
        const p = part(t, startled.startAt, startled.takeoff);
        return {
          ...startled.from, movement: 'hop', peck: (startled.from.peck ?? 0) * (1 - p),
          walk: 0, look: p * 0.85, compression: p * (quiet ? 0.18 : 0.27),
        };
      }
      if (t < startled.landingAt) {
        const p = part(t, startled.takeoff, startled.landingAt);
        return hop(startled.from, startled.to, p, quiet ? 15 : 24, startled.facesRight);
      }
      return t >= startled.farewell.steps[0].from
        ? farewellPose(t, startled.farewell)
        : trailPose(t, startled.trail, startled.to, startled.facesRight, quiet);
    }
    if (t < plan.settleAt) return arrivalPose(t, plan);
    if (t < plan.stepOffAt) {
      const p = part(t, plan.settleAt, plan.stepOffAt);
      return birdAt(plan.perch.x, plan.perch.y, plan.left, quiet ? 'look' : 'perch', {
        look: quiet ? Math.sin(p * Math.PI) * 0.53 : plan.detail === 'tilt' ? Math.sin(p * Math.PI) * 0.95 : look(t),
        blink: plan.detail === 'blink' ? Math.max(0, 1 - Math.abs(p - 0.5) * 9) : blink(t),
        peck: !quiet && plan.detail === 'peck' ? 0.36 * Math.max(0, 1 - Math.abs(p - 0.55) * 6) : 0,
        compression: (quiet ? 0.11 : 0.2) * Math.sin(Math.PI * part(t, plan.settleAt, plan.settleAt + 0.16)),
      });
    }
    if (t < plan.deskAt) {
      return hop(plan.perch, plan.start, part(t, plan.stepOffAt, plan.deskAt), 17, !plan.left);
    }
    return t >= plan.farewell.steps[0].from
      ? farewellPose(t, plan.farewell)
      : trailPose(t, plan.trail, plan.start, !plan.left, quiet);
  }
}

export function drawBirdVisit(ctx: CanvasRenderingContext2D, frame: BirdVisitFrame): void {
  if (!frame.pose) return;
  ctx.save();
  ctx.fillStyle = '#ab8050';
  for (const seed of frame.grains) {
    ctx.beginPath();
    ctx.ellipse(seed.x, seed.y, seed.size, seed.size * 0.57, seed.angle, 0, 2 * Math.PI);
    ctx.fill();
  }
  drawForagingBird(ctx, frame.pose);
  ctx.restore();
}
