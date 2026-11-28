// In the resident's 860 px drawing space the body moves left by distance.
// A planted paw must advance by that same distance to keep a fixed screen x.
const STRIDE = 96;
const STANCE = STRIDE * .62;
const SWING = STRIDE - STANCE;
const LIFTOFF = [0, .5, .25, .75];

function swingFoot(u, travel, from, height) {
  const ease = u * u * (3 - 2 * u);
  return {
    x: from + u * travel - (from + travel + STANCE / 2) * ease,
    y: -height * Math.sin(Math.PI * u) ** 2,
  };
}

export function residentFootstep(distance, leg) {
  const first = STRIDE * LIFTOFF[leg];
  const height = leg % 2 === 0 ? 16 : 13;
  if (distance < first) {
    // The far forepaw starts a short recovery from the photographed stance.
    // The other three feet support it at their actual photographed positions.
    const landing = first - STANCE;
    if (landing <= 0) return { x: distance, y: 0 };
    if (distance < landing) return swingFoot(distance / landing, landing, 0, height * .4);
    return { x: distance - landing - STANCE / 2, y: 0 };
  }
  const sinceFirst = distance - first;
  const phase = sinceFirst % STRIDE;
  if (phase >= SWING) return { x: phase - SWING - STANCE / 2, y: 0 };
  const start = sinceFirst < STRIDE && first <= STANCE ? first : STANCE / 2;
  return swingFoot(phase / SWING, SWING, start, height);
}

// Atlas source rectangles are registered in the untrimmed stage coordinates.
export function section(ctx, sheet, frame, x1, y1, x2, y2) {
  const [sx, sy, sw, sh, x, y, w, h] = frame;
  const l = Math.max(x, x1), r = Math.min(x + w, x2);
  const t = Math.max(y, y1), b = Math.min(y + h, y2);
  if (l >= r || t >= b) return;
  const u = sw / w, v = sh / h;
  ctx.drawImage(sheet, sx + (l-x)*u, sy + (t-y)*v, (r-l)*u, (b-t)*v, l, t, r-l, b-t);
}

export function drawResidentLeg(ctx, sheet, frame, left, right, joints, footstep) {
  // A weight of one at both ends of the toe translates the pad intact.
  // The slight overlap covers texel filtering across neighbouring strips.
  const { x, y } = footstep;
  for (let i = joints.length - 1; i > 0; i--) {
    const [top, start] = joints[i-1], [bottom, end] = joints[i];
    const slope = (end - start) / (bottom - top);
    const shift = start - slope * top;
    ctx.save();
    ctx.transform(1, 0, x*slope, 1 + y*slope, x*shift, y*shift);
    section(ctx, sheet, frame, left, top, right, bottom + 2);
    ctx.restore();
  }
}
