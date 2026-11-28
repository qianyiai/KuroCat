import { drawResidentLeg, residentFootstep, section } from './residentStep.js';
import { yieldSlice } from './yieldSlice.js';

const TOUCH = 0.72;
const HIGH = 0.89;
const RETREAT = 1.46;
const EXIT = 4.42;
const ORIGIN = 502.57;
const GROUND = 560;

function unit(value) {
  return Math.max(0, Math.min(1, value));
}
function smooth(value) {
  const u = unit(value);
  return u * u * (3 - 2 * u);
}
function mix(a, b, t) {
  return a + (b - a) * t;
}
function travel(time, a, b, start, end, startSpeed, endSpeed) {
  const u = unit((time - a) / (b - a));
  return mix(start, end, smooth(u)) + (b - a) * u * (1 - u) * ((1 - u) * startSpeed - u * endSpeed);
}
function retreatDistance(t) {
  if (t < 2.76) return travel(t, RETREAT, 2.76, 0, 365, 0, 195);
  if (t < 3.96) return travel(t, 2.76, 3.96, 365, 535, 195, 135);
  return travel(t, 3.96, EXIT, 535, 814, 135, 80);
}
function tailShape(points) {
  const p = new Path2D();
  for (const [i, point] of points.entries()) {
    if (i === 0) p.moveTo(...point);
    else p.lineTo(...point);
  }
  p.closePath();
  return p;
}
function tailBone(data) {
  const [x, y, tipX, tipY] = data;
  return {x, y, angle: Math.atan2(tipY-y, tipX-x), length: Math.hypot(tipX-x, tipY-y)};
}

// In these registered profiles the chest bridges both forelegs through y=456.
// Each divider lies in transparent space down to the pads. Far legs go behind
// near legs when they cross, just as they do in the standing pose.
const LEG_EDGES = [0, 374, 476, 592, 860];
const LEG_JOINTS = [[464, 0], [478, .07], [491, .30], [509, .73], [522, .95], [529, 1], [572, 1]];
const FORELEG_JOINTS = [[464, 0], [476, .09], [492, .34], [510, .66], [526, .91], [536, 1], [572, 1]];
const LEG_DEPTH_ORDER = [1, 3, 0, 2];

function rowEdges(data, width, row, x1, x2) {
  let first = x1, last = x2 - 1;
  const alpha = x => data[4 * (row * width + x) + 3];
  while (first < last && alpha(first) < 128) first++;
  while (last > first && alpha(last) < 128) last--;
  if (last <= first) return null;
  const aF = alpha(first), aFm = first > x1 ? alpha(first - 1) : 0;
  const aL = alpha(last), aLp = last + 1 < x2 ? alpha(last + 1) : 0;
  return [
    first - (aF - 128) / Math.max(1, aF - aFm),
    last + (aL - 128) / Math.max(1, aL - aLp),
  ];
}

// Replace the stretched photographed far foreleg (leg 3) with a perspective-scaled
// copy of the cleaner near foreleg (leg 2), keeping the chest armpit junction and
// coat/sock markings seamless across all five residents.
function prepareHeldPose(sheet, held) {
  const [sx, sy, sw, sh, ox, oy, w, h] = held;
  const canvasHeight = Math.max(h, 568 - oy);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, w, h);

  const stripX = 490, stripY = 456, stripW = 230;
  const stripH = Math.min(112, canvasHeight - (stripY - oy));
  const localX = stripX - ox, localY = stripY - oy;
  if (localX < 0 || localY < 0 || localX + stripW > w || stripH < 24) {
    return { sheet: canvas, rect: [0, 0, w, canvasHeight, ox, oy, w, canvasHeight] };
  }

  const image = ctx.getImageData(localX, localY, stripW, stripH);
  const data = image.data;
  const divider = 592 - stripX;
  const jointRow = 464 - stripY;
  const socket = rowEdges(data, stripW, jointRow, divider, stripW);
  const sockL = socket ? socket[0] : 602 - stripX;
  const sockR = socket ? socket[1] : 660 - stripX;

  // Build leg 2 template: mirror the upper shaft around x=537 so the armpit flare
  // and inner-chest coat fade face left toward the chest, then crossfade cleanly
  // into the unmirrored lower shin and forward-pointing paw.
  const legW = 100, axis = 537 - stripX;
  const comb = new Float32Array(stripH * legW * 4);
  const combEdges = new Array(stripH);
  for (let r = 0; r < stripH; r++) {
    const u = smooth((stripY + r - 498) / 24);
    for (let c = 0; c < legW; c++) {
      const mx = Math.max(0, Math.min(legW - 1, 2 * axis - c));
      const m0 = Math.floor(mx), m1 = Math.min(m0 + 1, legW - 1), mf = mx - m0;
      const kO = 4 * (r * stripW + c);
      const k0 = 4 * (r * stripW + m0), k1 = 4 * (r * stripW + m1);
      const aM = (data[k0 + 3] * (1 - mf) + data[k1 + 3] * mf) / 255;
      const aO = data[kO + 3] / 255;
      const a = aM * (1 - u) + aO * u;
      const dst = 4 * (r * legW + c);
      if (a > 1e-4) {
        const wM = aM * (1 - u), wO = aO * u;
        for (let ch = 0; ch < 3; ch++) {
          const mCol = data[k0 + ch] * (1 - mf) + data[k1 + ch] * mf;
          comb[dst + ch] = (mCol * wM + data[kO + ch] * wO) / a;
        }
      }
      comb[dst + 3] = a * 255;
    }
    combEdges[r] = rowEdges(comb, legW, r, 0, legW);
  }

  const sxScale = 0.89, syScale = 0.985;
  const refEdge = combEdges[476 - stripY];
  const refR = refEdge ? refEdge[1] : 76;
  const originX = (sockR - 1.5) - refR * sxScale;

  // Snapshot original shoulder row (y=464) for seamless top fur color crossfade.
  const origRow = data.slice(4 * jointRow * stripW, 4 * (jointRow + 1) * stripW);

  // Clear original far foreleg pixels at and below y=464.
  for (let r = jointRow; r < stripH; r++) {
    data.fill(0, 4 * (r * stripW + divider), 4 * ((r + 1) * stripW));
  }

  for (let r = jointRow; r < stripH; r++) {
    const stageY = stripY + r;
    const srcR = jointRow + (stageY - 464) / syScale;
    const r0 = Math.floor(srcR), r1 = r0 + 1;
    if (r0 < 0 || r1 >= stripH) continue;
    const e0 = combEdges[r0], e1 = combEdges[r1];
    if (!e0 || !e1) continue;
    const rf = srcR - r0;
    const sl = mix(e0[0], e1[0], rf);
    const sr = mix(e0[1], e1[1], rf);
    const natL = originX + sl * sxScale;
    const natR = originX + sr * sxScale;
    const edgeBlend = smooth((stageY - 464) / 18);
    const dstL = mix(sockL, natL, edgeBlend);
    const dstR = mix(sockR, natR, edgeBlend);
    const colorBlend = smooth((stageY - 464) / 12);
    const span = Math.max(1e-4, dstR - dstL);

    const xStart = Math.max(divider, Math.floor(dstL) - 3);
    const xEnd = Math.min(stripW - 1, Math.ceil(dstR) + 3);
    for (let c = xStart; c <= xEnd; c++) {
      const u = (c - dstL) / span;
      const sxF = sl + u * (sr - sl);
      if (sxF < 0 || sxF >= legW - 1) continue;
      const c0 = Math.floor(sxF), cf = sxF - c0;
      const i00 = 4 * (r0 * legW + c0), i01 = i00 + 4;
      const i10 = 4 * (r1 * legW + c0), i11 = i10 + 4;
      const a0 = mix(comb[i00 + 3], comb[i01 + 3], cf) / 255;
      const a1 = mix(comb[i10 + 3], comb[i11 + 3], cf) / 255;
      const a = mix(a0, a1, rf);
      if (a < 1e-4) continue;

      const dst = 4 * (r * stripW + c);
      let rgb0 = 0, rgb1 = 0, rgb2 = 0;
      for (let ch = 0; ch < 3; ch++) {
        const topP = mix(comb[i00 + ch] * (comb[i00 + 3] / 255), comb[i01 + ch] * (comb[i01 + 3] / 255), cf);
        const botP = mix(comb[i10 + ch] * (comb[i10 + 3] / 255), comb[i11 + ch] * (comb[i11 + 3] / 255), cf);
        const val = mix(topP, botP, rf) / a;
        if (ch === 0) rgb0 = val;
        else if (ch === 1) rgb1 = val;
        else rgb2 = val;
      }

      if (colorBlend < 1) {
        const oxF = Math.max(sockL + 1, Math.min(sockR - 1, sockL + u * (sockR - sockL)));
        const oc0 = Math.max(divider, Math.min(stripW - 2, Math.floor(oxF)));
        const ocf = oxF - oc0;
        const ok0 = 4 * oc0, ok1 = ok0 + 4;
        const oa0 = origRow[ok0 + 3] / 255, oa1 = origRow[ok1 + 3] / 255;
        const oa = mix(oa0, oa1, ocf);
        if (oa > 0.25) {
          const or0 = mix(origRow[ok0] * oa0, origRow[ok1] * oa1, ocf) / oa;
          const or1 = mix(origRow[ok0 + 1] * oa0, origRow[ok1 + 1] * oa1, ocf) / oa;
          const or2 = mix(origRow[ok0 + 2] * oa0, origRow[ok1 + 2] * oa1, ocf) / oa;
          rgb0 = mix(or0, rgb0, colorBlend);
          rgb1 = mix(or1, rgb1, colorBlend);
          rgb2 = mix(or2, rgb2, colorBlend);
        }
      }

      data[dst] = Math.max(0, Math.min(255, Math.round(rgb0)));
      data[dst + 1] = Math.max(0, Math.min(255, Math.round(rgb1)));
      data[dst + 2] = Math.max(0, Math.min(255, Math.round(rgb2)));
      data[dst + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }

  ctx.putImageData(image, localX, localY);
  return { sheet: canvas, rect: [0, 0, w, canvasHeight, ox, oy, w, canvasHeight] };
}

function backstep(ctx, sheet, frame, distance) {
  if (distance === 0) {
    ctx.drawImage(sheet, ...frame);
    return;
  }
  for (const leg of LEG_DEPTH_ORDER) {
    const step = residentFootstep(distance, leg);
    drawResidentLeg(ctx, sheet, frame, LEG_EDGES[leg], LEG_EDGES[leg + 1], leg >= 2 ? FORELEG_JOINTS : LEG_JOINTS, step);
  }
  section(ctx, sheet, frame, 0, 0, 860, LEG_JOINTS[0][0] + 2);
}

// The short-haired residents share a photographed silhouette. Keep the occasional
// whisker or toe at its exact opacity by patching only the differing pixels.
async function prepareCoat(id, loadArt, edits) {
  const color = loadArt('cast-resident/'+id+'.webp');
  // The ragdoll's registered image includes its own alpha and turn seam strips.
  if (id === 'ragdoll' || edits === undefined) return color;
  const [paint, silhouette] = await Promise.all([color, loadArt('cast-resident/coverage.webp')]);
  const canvas = document.createElement('canvas');
  canvas.width = paint.width;
  canvas.height = paint.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(silhouette, 0, 0);
  if (edits.length) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bytes = Uint8Array.from(atob(edits), c => c.charCodeAt(0));
    let position = 0;
    for (let i = 0; i < bytes.length;) {
      let byte, shift = 0;
      do {
        byte = bytes[i++];
        position += (byte & 127) << shift;
        shift += 7;
      } while (byte & 128);
      pixels.data[position*4+3] = bytes[i++];
    }
    ctx.putImageData(pixels, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(paint, 0, 0);
  return canvas;
}

// The photographed profile has a lighter coat than the native black seat.
// Grade the affected atlas rectangles once, as the resident is prepared.
async function matchBlackCoat(image, regions, frames, times, isRuff = false) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = pixels.data;
  const visited = new Set();
  const shade = Array.from({length:256}, (_, v) =>
    smooth((v-5)/13)*(1-smooth((v-43)/(isRuff ? 79 : 24))));
  const neutral = Array.from({length:256}, (_, v) => 1-smooth((v-10)/13));
  // Whiskers are thin neutral strokes, brighter than the cheek on both sides.
  const green = isRuff ? null : new Uint8Array(canvas.width*canvas.height);
  if (green) for (let p=0; p<green.length; p++) green[p]=rgba[4*p+1];
  let sliceStart = performance.now();
  for (const [i, frame] of frames.entries()) {
    const strength = smooth((times[i]-.75)/.15);
    for (const index of frame) {
      if (index < 0 || visited.has(index)) continue;
      visited.add(index);
      if (!strength) continue;
      if (performance.now() - sliceStart > 10) {
        await yieldSlice();
        sliceStart = performance.now();
      }
      const [x,y,w,h] = regions[index];
      for (let row=y; row<y+h; row++) {
        const end = 4*(row*canvas.width+x+w);
        for (let k=4*(row*canvas.width+x); k<end; k+=4) {
          if (!rgba[k+3]) continue;
          const r=rgba[k], g=rgba[k+1], b=rgba[k+2];
          let weight=strength*shade[Math.round((r+g+b)/3)]*neutral[Math.max(r,g,b)-Math.min(r,g,b)];
          if (!weight) continue;
          if (green && g>=30 && row>=y+2 && row+2<y+h) {
            const p=k/4, offset=2*canvas.width;
            const contrast=g-Math.max(green[p-offset],green[p+offset]);
            weight*=1-smooth((contrast-3)/7);
          }
          const luma=.2126*r+.7152*g+.0722*b;
          rgba[k]   = mix(r,.79*luma+.5,weight);
          rgba[k+1] = mix(g,.80*luma+1,weight);
          rgba[k+2] = mix(b,.86*luma+3,weight);
        }
      }
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export async function prepareCastResident(id, loadArt, loadData, nativeBody) {
  const data = await loadData('cast-resident/poses.json');
  if (!Object.hasOwn(data.cast, id)) throw new Error('Unknown resident '+id);
  const [coatImage, furImage, furLayout] = await Promise.all([
    prepareCoat(id, loadArt, data.coverageEdits[id]),
    loadArt('cast-resident/ruff.webp'), loadData('cast-resident/ruff.json')
  ]);
  const {regions, turn: breakdowns, head, front, side} = data.cast[id];
  await yieldSlice();
  const sheet = id === 'black'
    ? await matchBlackCoat(coatImage, regions, [...breakdowns,[0]], data.times)
    : coatImage;
  const furPaint = id === 'black'
    ? await matchBlackCoat(furImage, furLayout.regions, furLayout.cast[id].map(index => [index]), data.times, true)
    : furImage;
  await yieldSlice();
  const held = regions[0];
  const { sheet: heldSheet, rect: heldRect } = prepareHeldPose(sheet, held);
  // Reassemble the brief turn on integer canvas rows. This prevents the
  // joining edges from showing through at fractional display scales.
  const turnPhoto = document.createElement('canvas');
  turnPhoto.width = 860;
  turnPhoto.height = 572;
  const turnContext = turnPhoto.getContext('2d');
  let preparedPose = -1;
  function drawTurn(ctx, i) {
    if (i === breakdowns.length) {
      ctx.drawImage(heldSheet, ...heldRect);
      return;
    }
    if (i !== preparedPose) {
      turnContext.clearRect(0, 0, turnPhoto.width, turnPhoto.height);
      for (const region of breakdowns[i]) {
        if (region >= 0) turnContext.drawImage(sheet, ...regions[region]);
        else {
          const band = -region - 1;
          section(turnContext, heldSheet, heldRect, 0, data.bands[band], 860, data.bands[band + 1]);
        }
      }
      if (id === 'ragdoll') {
        // The soft gradient across each band is baked into a feathered strip at
        // the foot of the ragdoll sheet. Apply it once when the turn cel changes.
        const count = data.bands.length - 2;
        const stripTop = sheet.height - 14*Math.ceil(breakdowns.length*count/2);
        for (let band=0; band<count; band++) {
          const index=i*count+band;
          turnContext.drawImage(sheet, 2+(index%2)*434, stripTop+1+14*Math.floor(index/2), 430, 12,
            0, data.bands[band+1]-6, 860, 12);
        }
      }
      preparedPose = i;
    }
    ctx.drawImage(turnPhoto, 0, 0);
  }
  const firstTail = tailBone(front), lastTail = tailBone(side);
  const frontMask = tailShape([[860,352],[661,352],[661,421],[669,442],[668,459],[664,470],[658,484],[651,496],[860,496]]);
  const sideMask = tailShape([[0,40],[344,40],[344,195],[329,226],[313,256],[305,283],[308,299],[304,317],[299,331],[297,342],[298,352],[0,352]]);

  function raisedFur(ctx, i, seconds) {
    const rect = furLayout.regions[furLayout.cast[id][i]];
    if (!rect) return;
    const lift = smooth((seconds-TOUCH)/.15) * (1-smooth((seconds-1.87)/1.02));
    if (lift < .005) return;
    const [sx,sy,sw,sh,x,y,w,h] = rect;
    // The buried roots stay within the photographed spine even as the tufts
    // stand up and settle. The rest of the body occludes the hidden portion.
    ctx.drawImage(furPaint,sx,sy,sw,sh,x,y+h*(1-lift),w,h*lift);
  }

  function turnTail(ctx, u) {
    const startPhoto = u < .52;
    const photo = startPhoto ? firstTail : lastTail;
    const x = mix(firstTail.x,lastTail.x,u), y = mix(firstTail.y,lastTail.y,u);
    const angle = mix(firstTail.angle,lastTail.angle,u);
    const length = mix(firstTail.length,lastTail.length,u);
    ctx.save();
    ctx.translate(x,y); ctx.rotate(angle-photo.angle);
    ctx.scale(length/photo.length,length/photo.length); ctx.translate(-photo.x,-photo.y);
    ctx.clip(startPhoto ? frontMask : sideMask);
    if (startPhoto) ctx.drawImage(nativeBody,0,0);
    else ctx.drawImage(sheet,...held);
    ctx.restore();
    return [x+length*Math.cos(angle),y+length*Math.sin(angle)];
  }

  return (ctx,t,behind) => {
    if (t <= TOUCH) {
      const seatedHead={x:504.54, y:190.37, width:281.47, yaw:0, pitch:0, tension:0};
      behind?.(seatedHead);
      ctx.drawImage(nativeBody,0,0);
      return {tail: front.slice(2), root: [ORIGIN,GROUND], arch: 0, pose: 'seated', eyeAnger: 0, mouthOpen: 0,
        head: seatedHead};
    }
    if (t >= EXIT) return {tail: null, root: null, arch: 0, pose: 'offstage', eyeAnger: 0, mouthOpen: 0};
    const arch = smooth((t-TOUCH)/(HIGH-TOUCH));
    const turn = smooth((t-TOUCH)/(.935-TOUCH));
    const anger = smooth((t-TOUCH)/.105);
    const distance = t > RETREAT ? retreatDistance(t) : 0;
    const turnedHead={x: mix(504.54,head[0],turn)-distance, y: mix(190.37,head[1],turn),
      width: mix(281.47,head[2],turn), yaw: -45*turn, pitch: 0, tension: anger};
    behind?.(turnedHead);
    ctx.save(); ctx.translate(-distance,0);
    let tip = null;
    if (t < .935) {
      let i = 0;
      while (i+1 < data.times.length && t >= (data.times[i]+data.times[i+1])/2) i++;
      if (i !== breakdowns.length) {
        const point = turnTail(ctx,arch);
        if (arch < 1) tip = point;
      }
      raisedFur(ctx,i,t);
      drawTurn(ctx,i);
    } else {
      raisedFur(ctx,breakdowns.length,t);
      backstep(ctx,heldSheet,heldRect,distance);
    }
    ctx.restore();
    return {tail: tip, root: [ORIGIN-distance,GROUND], arch,
      pose: t<HIGH?'startle':t<=RETREAT?'arch':'retreat', eyeAnger: anger, mouthOpen: 0,
      head: turnedHead};
  };
}

