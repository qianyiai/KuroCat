import { yieldSlice } from './yieldSlice.js';

// Paints keep their original atlas rectangles. A neighboring pose supplies
// the base coat; the correction image restores the local pigment and light.
function readPixels(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  canvas.width = canvas.height = 1;
  return pixels;
}

function correction(value) {
  const delta = value - 128;
  return delta + Math.sign(delta) * 2 * Math.max(0, Math.abs(delta) - 64);
}

// Reuse a small look-up table rather than decoding the signed residual for
// each color channel of each reconstructed pixel.
const corrections = Int16Array.from({length: 256}, (_, value) => correction(value));

// The shift at a grid point usually matches its left or upper neighbor.
// Small differences take a single printable character in the shared pose data.
function readFlow(steps, count, cols, rows) {
  const values = new Int8Array(count * cols * rows * 2);
  let cursor = 0;
  for (let i = 0; i < values.length; i++) {
    let code = steps.charCodeAt(cursor++) - 35;
    if (code === 56) code = (steps.charCodeAt(cursor++) - 35) * 56 + steps.charCodeAt(cursor++) - 35;
    const left = i % cols ? values[i-1] : 0;
    const above = Math.floor(i / cols) % rows ? values[i-cols] : 0;
    const corner = i % cols && Math.floor(i / cols) % rows ? values[i-cols-1] : 0;
    const prediction = Math.min(Math.max(left, above), Math.max(Math.min(left, above), left + above - corner));
    values[i] = prediction + ((code >>> 1) ^ -(code & 1));
  }
  return values;
}

export async function expandCoat(layout, keyImage, patchImage) {
  const {frames, keys, patches, steps, grid} = layout.motion;
  const [cols, rows] = grid;
  const flow = readFlow(steps, layout.motion.flows ?? patches.length, cols, rows);
  const keyPixels = readPixels(keyImage), patchPixels = readPixels(patchImage);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(...layout.rects.map(([x,,w]) => x + w + 1));
  canvas.height = Math.max(...layout.rects.map(([,y,,h]) => y + h + 1));
  const ctx = canvas.getContext('2d');
  const gridSize = cols * rows;
  const keyStride = 4 * keyImage.width;

  let sliceStart = performance.now();
  for (let pose = 0; pose < frames.length; pose++) {
    // A cold switch may prepare a few million pixels. Give the running pet
    // a frame between slices before its switch animation clock starts.
    if (performance.now() - sliceStart > 8) {
      await yieldSlice();
      sliceStart = performance.now();
    }
    const [key, patch] = frames[pose];
    const [x, y, w, h] = layout.rects[pose];
    if (key < 0) {
      const [px, py] = patches[patch];
      ctx.drawImage(patchImage, px-1, py-1, w+2, h+2, x-1, y-1, w+2, h+2);
      continue;
    }
    const [kx, ky, kw, kh] = keys[key];
    if (patch === undefined) {
      ctx.drawImage(keyImage, kx - 1, ky - 1, kw + 2, kh + 2, x - 1, y - 1, w + 2, h + 2);
      continue;
    }
    const [px, py] = patches[patch];
    const tile = ctx.createImageData(w + 2, h + 2);
    const pixels = tile.data, stride = 4 * (w + 2);
    const xBase = new Float32Array(w), xCell = new Uint8Array(w), xMix = new Float32Array(w);
    for (let i = 0; i < w; i++) {
      xBase[i] = (i + .5) * kw / w - .5;
      const u = i * (cols - 1) / (w - 1);
      xCell[i] = Math.min(cols - 2, Math.floor(u));
      xMix[i] = u - xCell[i];
    }
    const shiftsX = new Float32Array(cols), shiftsY = new Float32Array(cols);
    for (let j = 0; j < h; j++) {
      const v = j * (rows - 1) / (h - 1);
      const row = Math.min(rows - 2, Math.floor(v)), mix = v - row;
      const iy = patch * 2 * gridSize + row * cols;
      const ix = iy + gridSize;
      for (let c = 0; c < cols; c++) {
        shiftsY[c] = .5 * (flow[iy+c] * (1-mix) + flow[iy+c+cols] * mix);
        shiftsX[c] = .5 * (flow[ix+c] * (1-mix) + flow[ix+c+cols] * mix);
      }
      const yBase = (j + .5) * kh / h - .5;
      const kwMax = kw - 1, kwLim = kw - 2, khMax = kh - 1, khLim = kh - 2;
      let p = 4 * (px + (py+j) * patchImage.width), dst = (1+j)*stride + 4;
      for (let i = 0; i < w; i++, p += 4, dst += 4) {
        const k = xCell[i], a = xMix[i], b = 1-a;
        let sx = xBase[i] + shiftsX[k]*b + shiftsX[k+1]*a;
        let sy = yBase + shiftsY[k]*b + shiftsY[k+1]*a;
        if (sx < 0) sx = 0; else if (sx > kwMax) sx = kwMax;
        if (sy < 0) sy = 0; else if (sy > khMax) sy = khMax;
        let left = sx | 0; if (left > kwLim) left = kwLim;
        let top = sy | 0; if (top > khLim) top = khLim;
        const fx = sx - left, invFx = 1 - fx, fy = sy - top, invFy = 1 - fy;
        const w00 = invFx * invFy, w01 = fx * invFy, w10 = invFx * fy, w11 = fx * fy;
        const c00 = (ky + top) * keyStride + ((kx + left) << 2);
        const c10 = c00 + keyStride;
        pixels[dst]     = (keyPixels[c00]     * w00 + keyPixels[c00 + 4] * w01 + keyPixels[c10]     * w10 + keyPixels[c10 + 4] * w11 + 0.5 | 0) + corrections[patchPixels[p]];
        pixels[dst + 1] = (keyPixels[c00 + 1] * w00 + keyPixels[c00 + 5] * w01 + keyPixels[c10 + 1] * w10 + keyPixels[c10 + 5] * w11 + 0.5 | 0) + corrections[patchPixels[p + 1]];
        pixels[dst + 2] = (keyPixels[c00 + 2] * w00 + keyPixels[c00 + 6] * w01 + keyPixels[c10 + 2] * w10 + keyPixels[c10 + 6] * w11 + 0.5 | 0) + corrections[patchPixels[p + 2]];
        pixels[dst + 3] = 255;
      }
      const start = (j+1)*stride;
      pixels.copyWithin(start, start+4, start+8);
      pixels.copyWithin(start+stride-4, start+stride-8, start+stride-4);
    }
    pixels.copyWithin(0, stride, 2*stride);
    pixels.copyWithin((h+1)*stride, h*stride, (h+1)*stride);
    ctx.putImageData(tile, x-1, y-1);
  }
  return canvas;
}
