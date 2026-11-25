export interface BirdPose {
  x: number;
  y: number;
  shadowY?: number;
  lift?: number;
  visibility?: number;
  facesRight?: boolean;
  compression?: number;
  wingSpread?: number;
  flutter?: number;
  tilt?: number;
  peck?: number;
  look?: number;
  blink?: number;
  walk?: number;
  stepPhase?: number;
  ruffle?: number;
  wipe?: number;
  crouch?: number;
}

// The sprite is anchored at its feet on the original 720 × 520 visit stage.

const INK = '#70503d';
const CREAM = '#fff1d1';
const APRICOT = '#efbb75';
const WING = '#dc985e';
const TOES = '#9a6146';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
function path(
  ctx: CanvasRenderingContext2D,
  trace: (path: CanvasRenderingContext2D) => void,
  fill: string | null,
  stroke: string | null = INK,
  width = 1.35,
) {
  ctx.beginPath();
  trace(ctx);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function oval(
  ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke: string | null = null,
) {
  path(ctx, (p) => p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), fill, stroke);
}

function openWing(ctx: CanvasRenderingContext2D, angle: number, length: number, fill: string) {
  ctx.save();
  ctx.rotate(angle);
  ctx.scale(length, length);
  path(ctx, (p) => {
    p.moveTo(-2, 3);
    p.quadraticCurveTo(-8, -11, -4, -26);
    p.quadraticCurveTo(-1, -36, 6, -33);
    p.quadraticCurveTo(10, -32, 10, -24);
    p.quadraticCurveTo(15, -30, 17, -25);
    p.quadraticCurveTo(19, -21, 15, -15);
    p.quadraticCurveTo(21, -18, 21, -13);
    p.quadraticCurveTo(19, -5, 8, 2);
    p.quadraticCurveTo(4, 7, -2, 3);
    p.closePath();
  }, fill);
  path(ctx, (p) => {
    p.moveTo(3, -6);
    p.quadraticCurveTo(9, -12, 11, -19);
    p.moveTo(0, -8);
    p.quadraticCurveTo(3, -16, 3, -23);
  }, null, '#a86f48', 0.9);
  ctx.restore();
}


function walkingToes(ctx: CanvasRenderingContext2D, walk: number, phase: number, lift: number) {
  for (const [index, x, y] of [[0, -7, 0], [1, 6, -2]]) {
    const step = phase + index * Math.PI;
    const footX = x + Math.cos(step) * walk * 4.5;
    const footY = y - Math.max(0, Math.sin(step)) * walk * 6;
    path(ctx, (p) => {
      p.moveTo(x + 1, -9);
      p.quadraticCurveTo(x + 1, -4, footX, footY - 1);
      p.quadraticCurveTo(footX - 4, footY - 1, footX - 6, footY + (lift > 0.5 ? 1 : 0));
      p.moveTo(footX, footY - 1);
      p.quadraticCurveTo(footX + 3, footY - 1, footX + 4, footY + 1);
    }, null, TOES, 1.5);
  }
}

export function drawForagingBird(ctx: CanvasRenderingContext2D, pose: BirdPose): void {
  const {
    x = 0, y = 0, shadowY = y, lift = 0, visibility = 1, facesRight = false,
    compression = 0, wingSpread = 0, flutter = 0, tilt = 0, peck = 0, look = 0,
    blink = 0, walk = 0, stepPhase = 0, ruffle = 0, wipe = 0, crouch = 0,
  } = pose;
  if (visibility <= 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha *= visibility;
  const shadowAlpha = 0.19 * (1 - clamp(lift / 100));
  if (shadowAlpha > 0.002) {
    oval(ctx, x + 1, shadowY + 1, 14 + Math.min(lift, 44) * 0.12, 3.4, 'rgba(81,53,40,' + shadowAlpha + ')');
  }

  const direction = facesRight ? -1 : 1;
  ctx.translate(x, y);
  ctx.scale(direction, 1);
  ctx.rotate(tilt * direction);
  ctx.scale(1 + compression * 0.34, 1 - compression);
  walkingToes(ctx, walk, stepPhase, lift);

  const strideBob = -Math.abs(Math.sin(stepPhase)) * walk * 1.4;
  const shake = Math.sin(stepPhase) * ruffle;
  const puff = ruffle * (0.75 + Math.cos(stepPhase * 2) * 0.25);
  const rub = wipe * direction * 7.5;
  const rubDown = clamp(Math.abs(wipe) * 3) * clamp(1 - peck) * 12;
  ctx.translate(shake * 2.2 - crouch * 4.1, strideBob + puff * 1.6 + crouch * 3.4);
  ctx.rotate(-peck * 0.10 + Math.cos(stepPhase) * walk * 0.045 + shake * 0.07 - crouch * 0.11);
  ctx.scale(1 + puff * 0.075, 1 - puff * 0.068 - crouch * 0.048);
  const spread = wingSpread;



  if (spread > 0.02) {
    ctx.save();
    ctx.translate(-6, -18);
    ctx.scale(-1, 1);
    openWing(ctx, 0.86 + flutter * 0.66 - shake * 0.10, 0.42 + spread * 0.56, '#e9af70');
    ctx.restore();
  }

  ctx.save();
  ctx.translate(8, -13);
  ctx.rotate(-peck * 0.12 + Math.sin(stepPhase + 0.86) * ruffle * 0.14 - crouch * 0.08);
  ctx.translate(-8, 13);
  path(ctx, (p) => {
    p.moveTo(7, -18);
    p.quadraticCurveTo(15, -24, 29, -25);
    p.quadraticCurveTo(26, -20, 23, -18);
    p.lineTo(27, -18);
    p.quadraticCurveTo(19, -8, 8, -8);
    p.closePath();
  }, '#ca8859');
  ctx.restore();

  path(ctx, (p) => {
    p.moveTo(-18, -17);
    p.quadraticCurveTo(-18, -29, -5, -30);
    p.quadraticCurveTo(14, -31, 19, -20);
    p.quadraticCurveTo(22, -8, 7, -5);
    p.quadraticCurveTo(-9, -3, -16, -11);
    p.quadraticCurveTo(-18, -14, -18, -17);
    p.closePath();
  }, APRICOT);

  path(ctx, (p) => {
    p.moveTo(-16, -21);
    p.quadraticCurveTo(-9, -22, -3, -17);
    p.quadraticCurveTo(5, -10, 15, -10);
    p.quadraticCurveTo(7, -5, -3, -6);
    p.quadraticCurveTo(-15, -6, -17, -16);
    p.closePath();
  }, CREAM, null);

  if (spread > 0.02) {
    ctx.save();
    ctx.translate(5, -20);
    openWing(ctx, 0.6 + flutter * 0.82 + shake * 0.12, 0.38 + spread * 0.68, '#e3a266');
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(5, -20);
    ctx.rotate(Math.sin(stepPhase - 0.72) * ruffle * 0.17);
    ctx.translate(-5, 20 - puff);
    path(ctx, (p) => {
      p.moveTo(-3, -21);
      p.quadraticCurveTo(4, -27, 12, -22);
      p.quadraticCurveTo(18, -18, 19, -13);
      p.quadraticCurveTo(15, -12, 11, -14);
      p.quadraticCurveTo(5, -11, 1, -15);
      p.quadraticCurveTo(-1, -17, -3, -21);
      p.closePath();
    }, WING);
    path(ctx, (p) => {
      p.moveTo(7, -19);
      p.quadraticCurveTo(11, -18, 13, -16);
    }, null, '#b47753', 1.0);
    ctx.restore();
  }


  ctx.save();
  ctx.translate(
    -10 - peck * 10 + rub - shake * 0.7 - crouch * 1.6,
    -23 + peck * 15 + rubDown - look * 2 + Math.sin(stepPhase) * walk * 0.8 + puff * 0.9,
  );
  ctx.rotate(-peck * 0.43 + look * 0.25 - Math.cos(stepPhase) * walk * 0.065 - shake * 0.043);
  path(ctx, (p) => {
    p.moveTo(-10, -2);
    p.quadraticCurveTo(-11, -10, -6, -14);
    p.quadraticCurveTo(-1, -19, 7, -15);
    p.quadraticCurveTo(14, -12, 12, -5);
    p.quadraticCurveTo(11, 1, 7, 5);
    p.quadraticCurveTo(1, 8, -7, 3);
    p.quadraticCurveTo(-10, 1, -10, -2);
    p.closePath();
  }, '#f4c686');

  path(ctx, (p) => {
    p.moveTo(-8, -4);
    p.quadraticCurveTo(-4, -7, 1, -4);
    p.quadraticCurveTo(5, -2, 6, 4);
    p.quadraticCurveTo(-2, 6, -7, 2);
    p.quadraticCurveTo(-9, 1, -8, -4);
    p.closePath();
  }, CREAM, null);

  path(ctx, (p) => {
    p.moveTo(-9, -6);
    p.quadraticCurveTo(-13, -6, -17, -2.5);
    p.quadraticCurveTo(-13, 0, -9, -2);
    p.closePath();
  }, '#d59354', INK, 1.05);


  if (blink > 0.56) {
    path(ctx, (p) => {
      p.moveTo(-6, -6);
      p.quadraticCurveTo(-3.7, -4, -1.4, -6);
    }, null, '#574138', 1.35);
  } else {
    oval(ctx, -4.4, -6.1, 1.85 + look * 0.13, (2.55 + look * 0.23) * (1 - blink * 0.62), '#503730');
    oval(ctx, -4.86, -6.99, 0.65, 0.65, '#fff9e9');
  }

  ctx.restore();
  ctx.restore();
}
