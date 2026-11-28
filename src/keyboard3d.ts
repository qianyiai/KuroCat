import * as THREE from 'three';
import { macbookFinishes } from './macbookFinish';
import { paintMacBookLegend } from './macbookLegend';
import {
  drawClickMark,
  PAD_DEPTH_RATIO,
  PAD_USABLE,
  padCenterDepth,
  padPosition,
  Trackpad,
  type PadPoint,
} from './trackpad';
import {
  getKeyboardLayout,
  resolveKeyByVk,
  type KeyboardLayoutId,
  type KeySpec,
} from './keyboardLayout';
import type { KeyboardOrientation } from './tailKeyTypes';
export { GAMEPAD_BTN, type GamepadInputState } from './gamepadTypes';
import { GAMEPAD_BTN, type GamepadInputState } from './gamepadTypes';

export class Spring1D {
  public x: number;
  public v = 0;
  public hz: number;
  public damping: number;

  constructor(x = 0, hz = 2, damping = 0.7) {
    this.x = x;
    this.hz = hz;
    this.damping = damping;
  }

  public step(target: number, dt: number): number {
    const w = 2 * Math.PI * this.hz;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (target - this.x) - 2 * this.damping * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  public kick(v: number): void {
    this.v += v;
  }

  public set(x: number): void {
    this.x = x;
    this.v = 0;
  }
}

export class Spring3D {
  public x: THREE.Vector3;
  public v = new THREE.Vector3();
  public hz: number;
  public damping: number;

  constructor(x: THREE.Vector3, hz = 3.2, damping = 0.78) {
    this.x = x.clone();
    this.hz = hz;
    this.damping = damping;
  }

  public step(target: THREE.Vector3, dt: number): THREE.Vector3 {
    const w = 2 * Math.PI * this.hz;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.x += (w * w * (target.x - this.x.x) - 2 * this.damping * w * this.v.x) * h;
      this.v.y += (w * w * (target.y - this.x.y) - 2 * this.damping * w * this.v.y) * h;
      this.v.z += (w * w * (target.z - this.x.z) - 2 * this.damping * w * this.v.z) * h;
      this.x.x += this.v.x * h;
      this.x.y += this.v.y * h;
      this.x.z += this.v.z * h;
    }
    return this.x;
  }
}

export const approach = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Lightweight static BufferGeometry merger (position + normal + optional vertex color)
 * to collapse static multi-mesh props (headset, keyboard chassis, whiskers, mouse seams) into single draw calls.
 */
export function mergeStaticGeometries(
  parts: Array<{ geo: THREE.BufferGeometry; matrix?: THREE.Matrix4; color?: string }>,
): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  let hasColor = false;

  const prepared = parts.map(({ geo, matrix, color }) => {
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (color !== undefined) hasColor = true;
    const pos = g.attributes.position;
    const idx = g.getIndex();
    totalVerts += pos.count;
    totalIndices += idx ? idx.count : pos.count;
    return { g, color };
  });

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = hasColor ? new Float32Array(totalVerts * 3) : null;
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);
  const tmpCol = new THREE.Color();

  let vOffset = 0;
  let iOffset = 0;
  for (const { g, color } of prepared) {
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const dst = (vOffset + i) * 3;
      positions[dst] = pos.getX(i);
      positions[dst + 1] = pos.getY(i);
      positions[dst + 2] = pos.getZ(i);
      normals[dst] = nrm.getX(i);
      normals[dst + 1] = nrm.getY(i);
      normals[dst + 2] = nrm.getZ(i);
    }
    if (colors) {
      tmpCol.set(color ?? '#ffffff');
      for (let i = 0; i < count; i++) {
        const dst = (vOffset + i) * 3;
        colors[dst] = tmpCol.r;
        colors[dst + 1] = tmpCol.g;
        colors[dst + 2] = tmpCol.b;
      }
    }
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[iOffset++] = idx.getX(i) + vOffset;
      }
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset++] = vOffset + i;
      }
    }
    vOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (colors) {
    merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/** Dynamic variable-radius 3D tube rebuilt cleanly in place each frame (zero GC churn, precomputed trig). */
export class TaperTube3D {
  public readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly m: number;
  private readonly pts: THREE.Vector3[];
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly T = new THREE.Vector3();
  private readonly N = new THREE.Vector3();
  private readonly B = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(segments: number, radial: number, material: THREE.Material, renderOrder = 0) {
    this.n = segments;
    this.m = radial;
    this.cosTable = new Float32Array(radial);
    this.sinTable = new Float32Array(radial);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      this.cosTable[j] = Math.cos(a);
      this.sinTable[j] = Math.sin(a);
    }

    const geo = new THREE.BufferGeometry();
    const count = (segments + 1) * radial;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute(
      'along',
      new THREE.BufferAttribute(
        Float32Array.from({ length: count }, (_, k) => Math.floor(k / radial) / segments),
        1,
      ),
    );
    const index: number[] = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b = i * radial + ((j + 1) % radial);
        const c = a + radial;
        const d = b + radial;
        index.push(a, b, c, b, d, c);
      }
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
    this.pts = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
  }

  public update(
    point: (t: number, out: THREE.Vector3) => void,
    radius: (t: number) => number,
    grow: number | ((t: number) => number) = 0,
  ): void {
    const { n, m, pts, cosTable, sinTable, T, N, B, tmp } = this;
    for (let i = 0; i <= n; i++) point(i / n, pts[i]);
    const pos = this.mesh.geometry.attributes.position.array as Float32Array;
    const nrm = this.mesh.geometry.attributes.normal.array as Float32Array;
    const isGrowFn = typeof grow === 'function';
    for (let i = 0; i <= n; i++) {
      T.subVectors(pts[Math.min(n, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      if (i === 0) {
        tmp.set(0, 1, 0);
        if (Math.abs(T.dot(tmp)) > 0.9) tmp.set(1, 0, 0);
        N.crossVectors(T, tmp).normalize();
      } else {
        B.crossVectors(N, T);
        N.crossVectors(T, B).normalize();
      }
      B.crossVectors(T, N).normalize();
      const u = i / n;
      const gVal = isGrowFn ? (grow as (t: number) => number)(u) : (grow as number);
      const r = Math.max(0.0008, radius(u) + gVal);
      const px = pts[i].x;
      const py = pts[i].y;
      const pz = pts[i].z;
      const nx = N.x;
      const ny = N.y;
      const nz = N.z;
      const bx = B.x;
      const by = B.y;
      const bz = B.z;
      for (let j = 0; j < m; j++) {
        const ca = cosTable[j];
        const sa = sinTable[j];
        const c = ca * r;
        const s = sa * r;
        const k = (i * m + j) * 3;
        pos[k] = px + nx * c + bx * s;
        pos[k + 1] = py + ny * c + by * s;
        pos[k + 2] = pz + nz * c + bz * s;
        nrm[k] = nx * ca + bx * sa;
        nrm[k + 1] = ny * ca + by * sa;
        nrm[k + 2] = nz * ca + bz * sa;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

interface KeyEntry3D {
  spec: KeySpec;
  index: number;
  x: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  down: boolean;
  depth: number;
  glow: number;
}

interface KeyAtlasData {
  tex: THREE.CanvasTexture;
  rects: Map<string, [number, number, number, number]>;
}

const keyAtlasCache = new Map<string, KeyAtlasData>();
const miscTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Packs all unique keycap legends for a layout + orientation into ONE compact CanvasTexture atlas
 * (96x96 per tile, linear-filtered without mipmaps -> ~4 MB VRAM instead of ~38 MB!), collapsing
 * 67-108 separate keycap textures and 201-324 draw calls into just 2 InstancedMesh draw calls total!
 */
function getKeycapAtlas(
  layoutId: KeyboardLayoutId,
  keys: readonly KeySpec[],
  rotated180: boolean,
  white: boolean,
): KeyAtlasData {
  const cacheKey = `${layoutId}|${rotated180 ? 1 : 0}|${white ? 1 : 0}`;
  const cached = keyAtlasCache.get(cacheKey);
  if (cached) return cached;

  // Evict previously cached layout atlases so switching 65%/98%/108%/MacBook never leaks GPU VRAM!
  for (const [oldKey, oldEntry] of keyAtlasCache) {
    if (oldKey !== cacheKey) {
      oldEntry.tex.dispose();
      keyAtlasCache.delete(oldKey);
    }
  }

  const unique: Array<{ key: string; label: string; accent: 'base' | 'mod' | 'orange'; spec: KeySpec }> = [];
  const seen = new Set<string>();
  for (const spec of keys) {
    const accent: 'base' | 'mod' | 'orange' =
      spec.accent === 'orange' ? 'orange' : spec.accent === 'mod' ? 'mod' : 'base';
    const label = spec.id === 'space' ? '' : spec.id === 'esc' ? 'Esc' : spec.label;
    const tk = layoutId === 'macbook' ? spec.id : `${label}|${accent}`;
    if (!seen.has(tk)) {
      seen.add(tk);
      unique.push({ key: tk, label, accent, spec });
    }
  }

  // Place orange accent tiles on their own isolated bottom row so filtering never bleeds onto cream keys!
  const nonOrange = unique.filter((u) => u.accent !== 'orange');
  const orangeOnly = unique.filter((u) => u.accent === 'orange');

  const CELL = layoutId === 'macbook' ? 128 : 96;
  const cols = nonOrange.length <= 56 ? 8 : 12;
  const nonOrangeRows = Math.ceil(nonOrange.length / cols);
  const orangeRows = Math.ceil(orangeOnly.length / cols);
  const totalRows = Math.max(1, nonOrangeRows + orangeRows);
  const atlasW = cols * CELL;
  const atlasH = totalRows * CELL;

  const c = document.createElement('canvas');
  c.width = atlasW;
  c.height = atlasH;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f9f8f3';
  g.fillRect(0, 0, atlasW, atlasH);

  const rects = new Map<string, [number, number, number, number]>();
  const PAD = 7.5;

  const paintTile = (
    item: { key: string; label: string; accent: 'base' | 'mod' | 'orange'; spec: KeySpec },
    col: number,
    row: number,
  ) => {
    const ox = col * CELL;
    const oy = row * CELL;

    g.fillStyle =
      item.accent === 'orange' ? '#f59b2e' : item.accent === 'mod' ? '#e6e4db' : '#f9f8f3';
    g.fillRect(ox, oy, CELL, CELL);

    // Sculpted concave PBT keycap sheen
    const grad = g.createLinearGradient(0, oy + PAD, 0, oy + CELL - PAD);
    grad.addColorStop(0, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0.08)');
    g.fillStyle = grad;
    g.fillRect(ox, oy, CELL, CELL);

    if (layoutId === 'macbook') {
      const finish = macbookFinishes[white ? 'white' : 'black'];
      g.fillStyle = finish.top;
      g.fillRect(ox, oy, CELL, CELL);
      g.save();
      g.translate(ox + CELL / 2, oy + CELL / 2);
      const tile = CELL - PAD * 2;
      // The square atlas tile stretches onto a rectangular cap; paint in cap space.
      const aspect = item.spec.uWidth / (item.spec.rowSpan ?? 1);
      g.scale(1 / aspect, 1);
      paintMacBookLegend(g, item.spec, tile * aspect, tile, rotated180, finish.ink);
      g.restore();
    } else if (item.label) {
      g.save();
      g.translate(ox + CELL * 0.5, oy + CELL * 0.5);
      if (rotated180) g.rotate(Math.PI);
      const len = item.label.length;
      const fontSize = len >= 4 ? 22 : len === 3 ? 26 : len === 2 ? 32 : 39;
      g.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
      g.fillStyle = item.accent === 'orange' ? '#ffffff' : '#2b2d34';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(item.label, 0, 1.5);
      g.restore();
    }

    // CanvasTexture uses flipY = true: canvas y=0 -> v=1, y=atlasH -> v=0
    const u0 = (ox + PAD) / atlasW;
    const du = (CELL - PAD * 2) / atlasW;
    const v0 = 1.0 - (oy + CELL - PAD) / atlasH;
    const dv = (CELL - PAD * 2) / atlasH;
    rects.set(item.key, [u0, v0, du, dv]);
  };

  for (let i = 0; i < nonOrange.length; i++) {
    paintTile(nonOrange[i], i % cols, Math.floor(i / cols));
  }
  if (orangeOnly.length > 0) {
    g.fillStyle = '#f59b2e';
    g.fillRect(0, nonOrangeRows * CELL, atlasW, orangeRows * CELL);
    for (let i = 0; i < orangeOnly.length; i++) {
      paintTile(orangeOnly[i], i % cols, nonOrangeRows + Math.floor(i / cols));
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = layoutId === 'macbook';
  tex.minFilter = tex.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (tex.generateMipmaps) tex.anisotropy = 4;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const entry: KeyAtlasData = { tex, rects };
  keyAtlasCache.set(cacheKey, entry);
  return entry;
}

/** Unit chiclet keycap with rounded corners for MacBook ANSI layout (stays 100% instanced). */
function makeChicletGeometry() {
  const shape = new THREE.Shape();
  const r = 0.12;
  shape.moveTo(-0.5 + r, -0.5);
  shape.lineTo(0.5 - r, -0.5);
  shape.quadraticCurveTo(0.5, -0.5, 0.5, -0.5 + r);
  shape.lineTo(0.5, 0.5 - r);
  shape.quadraticCurveTo(0.5, 0.5, 0.5 - r, 0.5);
  shape.lineTo(-0.5 + r, 0.5);
  shape.quadraticCurveTo(-0.5, 0.5, -0.5, 0.5 - r);
  shape.lineTo(-0.5, -0.5 + r);
  shape.quadraticCurveTo(-0.5, -0.5, -0.5 + r, -0.5);
  const side = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 });
  const walls = side.groups[1];
  side.setDrawRange(walls.start, walls.count);
  side.rotateX(-Math.PI / 2);
  const top = new THREE.ShapeGeometry(shape, 4);
  const uv = top.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + 0.5, uv.getY(i) + 0.5);
  top.rotateX(-Math.PI / 2);
  top.translate(0, 1, 0);
  return { side, top };
}

export function disposeKeyboardCaches(): void {
  for (const entry of keyAtlasCache.values()) {
    entry.tex.dispose();
  }
  keyAtlasCache.clear();
  for (const tex of miscTextureCache.values()) {
    tex.dispose();
  }
  miscTextureCache.clear();
}

function makeSoftShadowTexture(): THREE.CanvasTexture {
  const hit = miscTextureCache.get('shadow:desk');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 22, 128, 128, 122);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.44)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.20)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set('shadow:desk', tex);
  return tex;
}

function makePrivacyTexture(): THREE.CanvasTexture {
  const hit = miscTextureCache.get('privacy:shield');
  if (hit) return hit;
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 512;
  pCanvas.height = 160;
  const pg = pCanvas.getContext('2d')!;
  pg.fillStyle = 'rgba(15, 20, 32, 0.88)';
  pg.fillRect(0, 0, 512, 160);
  pg.strokeStyle = 'rgba(244, 114, 182, 0.65)';
  pg.lineWidth = 6;
  pg.strokeRect(6, 6, 500, 148);
  pg.font = 'bold 34px "Segoe UI", "PingFang SC", sans-serif';
  pg.fillStyle = '#fbcfe8';
  pg.textAlign = 'center';
  pg.textBaseline = 'middle';
  pg.fillText('🔒 密码防偷窥 · 已隐藏按键', 256, 80);
  const pTex = new THREE.CanvasTexture(pCanvas);
  pTex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set('privacy:shield', pTex);
  return pTex;
}

function makeMouseLabelTexture(char: 'L' | 'R', rotated180: boolean): THREE.CanvasTexture {
  const key = `mouse:${char}:${rotated180 ? 1 : 0}`;
  const hit = miscTextureCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.save();
  g.translate(32, 32);
  if (rotated180) g.rotate(Math.PI);
  g.font = '800 36px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = 'rgba(42, 46, 56, 0.56)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(char, 0, 2);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set(key, tex);
  return tex;
}

function makeRoundedSlabGeo(w: number, d: number, h: number, r: number, y: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const z0 = -d / 2;
  s.moveTo(x0 + r, z0);
  s.lineTo(x0 + w - r, z0);
  s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
  s.lineTo(x0 + w, z0 + d - r);
  s.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
  s.lineTo(x0 + r, z0 + d);
  s.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r);
  s.lineTo(x0, z0 + r);
  s.quadraticCurveTo(x0, z0, x0 + r, z0);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y + h, 0);
  return g;
}

function makeGamepadContourShape(scaleX = 1, scaleZ = 1): THREE.Shape {
  const sx = (v: number) => v * scaleX;
  const sz = (v: number) => v * scaleZ;
  const s = new THREE.Shape();
  // Smooth ergonomic Pro-Controller silhouette (symmetric around X = 0, top edge = -Z, handles = +Z)
  s.moveTo(0, sz(-0.295));
  s.bezierCurveTo(sx(0.16), sz(-0.295), sx(0.28), sz(-0.335), sx(0.42), sz(-0.305));
  s.bezierCurveTo(sx(0.55), sz(-0.275), sx(0.61), sz(-0.14), sx(0.64), sz(0.04));
  s.bezierCurveTo(sx(0.675), sz(0.22), sx(0.66), sz(0.41), sx(0.535), sz(0.45));
  s.bezierCurveTo(sx(0.43), sz(0.48), sx(0.35), sz(0.39), sx(0.295), sz(0.255));
  s.bezierCurveTo(sx(0.24), sz(0.165), sx(0.145), sz(0.155), 0, sz(0.155));
  s.bezierCurveTo(sx(-0.145), sz(0.155), sx(-0.24), sz(0.165), sx(-0.295), sz(0.255));
  s.bezierCurveTo(sx(-0.35), sz(0.39), sx(-0.43), sz(0.48), sx(-0.535), sz(0.45));
  s.bezierCurveTo(sx(-0.66), sz(0.41), sx(-0.675), sz(0.22), sx(-0.64), sz(0.04));
  s.bezierCurveTo(sx(-0.61), sz(-0.14), sx(-0.55), sz(-0.275), sx(-0.42), sz(-0.305));
  s.bezierCurveTo(sx(-0.28), sz(-0.335), sx(-0.16), sz(-0.295), 0, sz(-0.295));
  return s;
}

function makeGamepadBtnLetterTexture(letter: 'A' | 'B' | 'X' | 'Y', bgHex: string, fgHex: string): THREE.CanvasTexture {
  const key = `gp:btn:${letter}`;
  const hit = miscTextureCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bgHex;
  g.fillRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(24, 20, 4, 32, 32, 34);
  grad.addColorStop(0, 'rgba(255,255,255,0.34)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.font = '900 38px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = fgHex;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set(key, tex);
  return tex;
}

function drawRoundedRect2D(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

function makeGamepadCurvedBumperGeo(side: -1 | 1): THREE.ExtrudeGeometry {
  // Authentic Xbox / Pro Controller curved upper bumper arc hugging the front shoulder bezier
  const s = new THREE.Shape();
  const x = (v: number) => side * v;
  if (side > 0) {
    s.moveTo(x(0.145), -0.296);
    s.bezierCurveTo(x(0.24), -0.324, x(0.36), -0.326, x(0.475), -0.285);
    s.quadraticCurveTo(x(0.505), -0.272, x(0.495), -0.242);
    s.bezierCurveTo(x(0.37), -0.268, x(0.24), -0.266, x(0.15), -0.252);
    s.quadraticCurveTo(x(0.125), -0.256, x(0.145), -0.296);
  } else {
    s.moveTo(x(0.145), -0.296);
    s.quadraticCurveTo(x(0.125), -0.256, x(0.15), -0.252);
    s.bezierCurveTo(x(0.24), -0.266, x(0.37), -0.268, x(0.495), -0.242);
    s.quadraticCurveTo(x(0.505), -0.272, x(0.475), -0.285);
    s.bezierCurveTo(x(0.36), -0.326, x(0.24), -0.324, x(0.145), -0.296);
  }
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.044,
    bevelEnabled: true,
    bevelThickness: 0.011,
    bevelSize: 0.010,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geo.rotateX(Math.PI / 2);
  return geo;
}

function makeGamepadCurvedTriggerGeo(side: -1 | 1): THREE.ExtrudeGeometry {
  // Sculpted Xbox analog trigger paddle positioned directly beneath the upper bumper (hinged at z = 0)
  const s = new THREE.Shape();
  const x = (v: number) => side * v;
  if (side > 0) {
    s.moveTo(x(0.225), -0.295);
    s.bezierCurveTo(x(0.28), -0.312, x(0.39), -0.310, x(0.445), -0.282);
    s.bezierCurveTo(x(0.455), -0.352, x(0.425), -0.415, x(0.335), -0.418);
    s.bezierCurveTo(x(0.250), -0.415, x(0.215), -0.358, x(0.225), -0.295);
  } else {
    s.moveTo(x(0.225), -0.295);
    s.bezierCurveTo(x(0.215), -0.358, x(0.250), -0.415, x(0.335), -0.418);
    s.bezierCurveTo(x(0.425), -0.415, x(0.455), -0.352, x(0.445), -0.282);
    s.bezierCurveTo(x(0.39), -0.310, x(0.28), -0.312, x(0.225), -0.295);
  }
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.056,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.010,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0.310);
  return geo;
}

function makeGamepadShoulderPillTexture(
  label: 'LB' | 'RB' | 'LT' | 'RT',
  isTrigger: boolean,
): THREE.CanvasTexture {
  const key = `gp:shpill:${label}`;
  const hit = miscTextureCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 76;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 160, 76);

  const fill = isTrigger ? '#ff6b2b' : '#22d3ee';
  const stroke = isTrigger ? '#7c2d12' : '#0c4a6e';
  const hi = isTrigger ? '#ffedd5' : '#e0f2fe';
  const fg = isTrigger ? '#ffffff' : '#082f49';

  // Crisp outer dark contour for high legibility over both light and dark game scenes
  drawRoundedRect2D(g, 8, 8, 144, 60, 26);
  g.fillStyle = stroke;
  g.fill();

  drawRoundedRect2D(g, 13, 13, 134, 50, 22);
  g.fillStyle = fill;
  g.fill();

  const grad = g.createLinearGradient(0, 13, 0, 63);
  grad.addColorStop(0, 'rgba(255,255,255,0.34)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = grad;
  g.fill();

  g.lineWidth = 2.5;
  g.strokeStyle = hi;
  g.stroke();

  g.font = '900 36px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 80, isTrigger ? 35 : 39);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  miscTextureCache.set(key, tex);
  return tex;
}

function createInstancedKeyTopMaterial(atlasTex: THREE.CanvasTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlasTex },
    },
    vertexShader: `
      attribute vec4 aUvRect;
      attribute vec3 aTint;
      varying vec2 vAtlasUv;
      varying vec3 vTint;
      void main() {
        vAtlasUv = aUvRect.xy + uv * aUvRect.zw;
        vTint = aTint;
        vec4 mvPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      varying vec2 vAtlasUv;
      varying vec3 vTint;
      void main() {
        vec4 texel = texture2D(uAtlas, vAtlasUv);
        gl_FragColor = vec4(texel.rgb * vTint, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * KuroCat's iconic clean desktop gear in real 3D:
 * - Slightly canted matte-charcoal mechanical keyboard rendered with 2 InstancedMeshes + 1 Texture Atlas
 * - Cordless oval split-plate L/R mini mouse with engraved L/R & dual-color highlight
 */
export class KeyboardAndMouse3D {
  public readonly boardGroup = new THREE.Group();
  public readonly mouseGroup = new THREE.Group();
  public readonly deskGroup = new THREE.Group();

  private readonly capSideGeo: THREE.CylinderGeometry;
  private readonly capTopBaseGeo: THREE.PlaneGeometry;
  private readonly capSideMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private readonly chassisMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly kbShadowMat: THREE.MeshBasicMaterial;
  private readonly shadowTex = makeSoftShadowTexture();

  private readonly sideColorBase = new THREE.Color('#dad7cd');
  private readonly sideColorMod = new THREE.Color('#c4c0b4');
  private readonly sideColorOrange = new THREE.Color('#c4741a');
  private readonly whiteColor = new THREE.Color('#ffffff');

  private keys = new Map<string, KeyEntry3D>();
  private keysByIndex: KeyEntry3D[] = [];
  private activeKeys = new Set<KeyEntry3D>();
  private sideInstanced: THREE.InstancedMesh | null = null;
  private topInstanced: THREE.InstancedMesh | null = null;
  private topTintAttr: THREE.InstancedBufferAttribute | null = null;
  private topTintArray: Float32Array | null = null;
  private boardDisposables: Array<{ dispose(): void }> = [];

  private layoutId: KeyboardLayoutId = '65';
  private orientation: KeyboardOrientation = 'cat';
  private whiteKeyboard = false;
  private readonly macSideColor = new THREE.Color();
  public readonly pad = new Trackpad();
  private readonly padGroup = new THREE.Group();
  private readonly padWidth = 0.75;
  private readonly padDepth = this.padWidth * PAD_DEPTH_RATIO;
  private readonly padHome = new THREE.Vector3();
  private readonly clickMarker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly padDots = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.023, 0.023, 0.003, 24),
    new THREE.MeshBasicMaterial({ color: '#217982' }),
    16,
  );
  private readonly dotMatrix = new THREE.Matrix4();
  private hitColor = new THREE.Color('#d4f044');
  private rightBtnColor = new THREE.Color('#ff7b3b');
  private boardH = 0.115;
  private capH = 0.056;
  private boardWidth = 2.4;

  // Scratch objects (zero per-frame GC allocations)
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpCol = new THREE.Color();
  private readonly hitInvMat = new THREE.Matrix4();
  private readonly hitLocalRay = new THREE.Ray();
  private readonly hitPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPt = new THREE.Vector3();

  // Cordless 3D KuroCat Mini Mouse
  private readonly mouseShape = new THREE.Group();
  private readonly mouseBodyMat: THREE.MeshBasicMaterial;
  private readonly leftBtnMat: THREE.MeshBasicMaterial;
  private readonly rightBtnMat: THREE.MeshBasicMaterial;
  private readonly wheelMat: THREE.MeshBasicMaterial;
  private readonly mouseLabelLMat: THREE.MeshBasicMaterial;
  private readonly mouseLabelRMat: THREE.MeshBasicMaterial;
  private readonly mouseHome = new THREE.Vector3(-1.32, 0.015, 1.04);
  private readonly mouseOffset = new THREE.Vector3();
  private readonly mouseTarget = new THREE.Vector3();
  private readonly mouseFollow = new Spring3D(new THREE.Vector3(), 5.5, 0.78);
  private leftPress = 0;
  private rightPress = 0;
  private wheelGlow = 0;
  private lastDeskHopY = Number.NaN;

  // Sleek 3D Drawing Tablet + Stylus Pen with live fading glowing strokes
  private tabletActive = false;
  private readonly tabletGroup = new THREE.Group();
  private readonly tabletHome = new THREE.Vector3(-1.26, 0.015, 1.04);
  private readonly stylusGroup = new THREE.Group();
  private readonly tabletLedMat: THREE.MeshBasicMaterial;
  private readonly stylusRingMat: THREE.MeshBasicMaterial;
  private readonly tabletPadCanvas: HTMLCanvasElement;
  private readonly tabletPadCtx: CanvasRenderingContext2D;
  private readonly tabletPadTex: THREE.CanvasTexture;
  private tabletPadDirty = true;
  private tabletClock = 0;
  private tabletWasDrawing = false;
  private tabletIdleBlend = 0;
  private readonly tabletPenTarget = new THREE.Vector3(0.055, 0, 0);
  private readonly tabletPenPos = new THREE.Vector3(0.055, 0, 0);
  private readonly tabletPenFollow = new Spring3D(new THREE.Vector3(0.055, 0, 0), 7.2, 0.80);
  private readonly tabletStrokes: Array<{ u: number; v: number; t: number; breakLine: boolean }> = [];
  private readonly tabletPadCenterX = 0.055;
  private readonly tabletPadW = 0.40;
  private readonly tabletPadD = 0.36;
  private readonly tabletThickness = 0.032;

  // Sculpted 3D KuroCat Pro Gamepad (Plan A: flat-on-desk oversized Pro Controller, cat-facing + 3-limb targets)
  private gamepadActive = false;
  private readonly gamepadGroup = new THREE.Group();
  private readonly gamepadBody = new THREE.Group();
  private readonly gamepadRig = new THREE.Group();
  private readonly gamepadHome = new THREE.Vector3(0.0, 0.015, 1.08);
  private readonly gpLeftStick = new THREE.Group();
  private readonly gpRightStick = new THREE.Group();
  private readonly gpLeftStickCapMat = new THREE.MeshBasicMaterial({ color: '#4d566b' });
  private readonly gpRightStickCapMat = new THREE.MeshBasicMaterial({ color: '#4d566b' });
  private readonly gpHomeLedMat = new THREE.MeshBasicMaterial({ color: '#d4f044' });
  private readonly gpShoulderL: {
    side: -1 | 1;
    bumperGroup: THREE.Group;
    bumperMat: THREE.MeshBasicMaterial;
    bumperAccentMat: THREE.MeshBasicMaterial;
    triggerPivot: THREE.Group;
    triggerMat: THREE.MeshBasicMaterial;
    bBadgeGroup: THREE.Group;
    bBadgeMat: THREE.MeshBasicMaterial;
    tBadgeGroup: THREE.Group;
    tBadgeMat: THREE.MeshBasicMaterial;
    tGaugeFill: THREE.Mesh;
  };
  private readonly gpShoulderR: {
    side: -1 | 1;
    bumperGroup: THREE.Group;
    bumperMat: THREE.MeshBasicMaterial;
    bumperAccentMat: THREE.MeshBasicMaterial;
    triggerPivot: THREE.Group;
    triggerMat: THREE.MeshBasicMaterial;
    bBadgeGroup: THREE.Group;
    bBadgeMat: THREE.MeshBasicMaterial;
    tBadgeGroup: THREE.Group;
    tBadgeMat: THREE.MeshBasicMaterial;
    tGaugeFill: THREE.Mesh;
  };
  private readonly gpDpadMeshes: Record<'up' | 'down' | 'left' | 'right', { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; baseY: number }>;
  private readonly gpFaceBtns: Array<{
    bit: number;
    group: THREE.Group;
    sideMat: THREE.MeshBasicMaterial;
    topMat: THREE.MeshBasicMaterial;
    baseColor: THREE.Color;
    baseY: number;
  }> = [];
  private readonly gpBackBtn: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; baseY: number };
  private readonly gpStartBtn: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; baseY: number };
  private gpTarget: GamepadInputState = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0 };
  private gpSmLx = 0;
  private gpSmLy = 0;
  private gpSmRx = 0;
  private gpSmRy = 0;
  private gpSmLt = 0;
  private gpSmRt = 0;
  private gpBtnAnim = new Float32Array(12);
  private gpClock = 0;
  private gpBounce = 0;
  private gpTapL = 0;
  private gpTapR = 0;
  private gpPrevButtons = 0;
  private gpPrevLtActive = false;
  private gpPrevRtActive = false;
  private readonly gpBaseDark = new THREE.Color('#282d3a');
  private readonly gpBumperDark = new THREE.Color('#343c4e');
  private readonly gpBumperActive = new THREE.Color('#22d3ee');
  private readonly gpTriggerDark = new THREE.Color('#202634');
  private readonly gpTriggerActive = new THREE.Color('#ff6b2b');
  private readonly gpStickRimIdle = new THREE.Color('#4d566b');

  private privacyPlate: THREE.Mesh | null = null;
  private privacyMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    // Open-ended 4-sided beveled keycap frustum (no invisible underside!)
    this.capSideGeo = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.80, Math.SQRT1_2, 1, 4, 1, true);
    this.capSideGeo.rotateY(Math.PI / 4);
    this.capSideGeo.translate(0, 0.5, 0);

    // Exact square top face matching the frustum top corners (+-0.40 at y=1.0)
    this.capTopBaseGeo = new THREE.PlaneGeometry(0.80, 0.80);
    this.capTopBaseGeo.rotateX(-Math.PI / 2);
    this.capTopBaseGeo.translate(0, 1.0, 0);

    this.kbShadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
    });
    this.privacyMat = new THREE.MeshBasicMaterial({
      map: makePrivacyTexture(),
      transparent: true,
      opacity: 0,
      depthTest: false,
    });

    // Subtle playful KuroCat keyboard tilt matching original catEngine.ts
    this.boardGroup.position.set(0.24, 0.015, 1.08);
    this.boardGroup.rotation.set(0.06, -0.042, 0);
    this.deskGroup.add(this.boardGroup);

    // Build Cordless KuroCat Oval Split-Plate Mini Mouse
    this.mouseGroup.position.copy(this.mouseHome);
    this.mouseShape.rotation.y = -0.10;
    this.mouseGroup.add(this.mouseShape);

    const MW = 0.165;
    const MH = 0.098;
    const ML = 0.228;
    const domeGeo = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const q = domeGeo.attributes.position;
    const colors: number[] = [];
    const topC = new THREE.Color('#f7f7f2');
    const sideC = new THREE.Color('#cbc8be');
    const c = new THREE.Color();
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i);
      const y = q.getY(i);
      const z = q.getZ(i);
      q.setXYZ(i, x * (1 - 0.07 * z), y * (1 - 0.12 * z), z);
      c.copy(sideC).lerp(topC, smoothstep(0.08, 0.76, y));
      colors.push(c.r, c.g, c.b);
    }
    domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mouseShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(MW * 3.1, ML * 2.8),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.78 }),
    );
    mouseShadow.rotation.x = -Math.PI / 2;
    mouseShadow.position.set(0, 0.002, 0.012);

    const baseSkirt = new THREE.Mesh(
      new THREE.CylinderGeometry(MW * 0.96, MW * 0.92, 0.018, 24),
      new THREE.MeshBasicMaterial({ color: '#b7b5ac' }),
    );
    baseSkirt.scale.set(1, 1, ML / MW);
    baseSkirt.position.y = 0.008;

    this.mouseBodyMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: '#ffffff' });
    const dome = new THREE.Mesh(domeGeo, this.mouseBodyMat);
    dome.scale.set(MW, MH, ML);
    dome.position.y = 0.012;

    const onTop = (x: number, z: number) =>
      0.012 +
      MH *
        (1 - (0.12 * z) / ML) *
        Math.sqrt(Math.max(0, 1 - (x / (MW * (1 - (0.07 * z) / ML))) ** 2 - (z / ML) ** 2));

    // Merge vertical & horizontal mouse seams into a single static draw call
    const seamMat = new THREE.MeshBasicMaterial({ color: '#8e9099', depthTest: true });
    const vSeam = new TaperTube3D(12, 4, seamMat, 6);
    vSeam.update(
      (t, out) => {
        const z = mix(-0.01, ML * 0.95, t);
        out.set(0, onTop(0, z) + 0.003, z);
      },
      () => 0.0038,
    );
    const hSeam = new TaperTube3D(14, 4, seamMat, 6);
    hSeam.update(
      (t, out) => {
        const x = mix(-MW * 0.94, MW * 0.94, t);
        const z = -0.01 + 0.012 * Math.cos(Math.PI * (t - 0.5));
        out.set(x, onTop(x, z) + 0.003, z);
      },
      () => 0.0036,
    );
    const mergedSeamsGeo = mergeStaticGeometries([
      { geo: vSeam.mesh.geometry },
      { geo: hSeam.mesh.geometry },
    ]);
    vSeam.mesh.geometry.dispose();
    hSeam.mesh.geometry.dispose();
    const seamsMesh = new THREE.Mesh(mergedSeamsGeo, seamMat);
    seamsMesh.renderOrder = 6;

    this.wheelMat = new THREE.MeshBasicMaterial({ color: '#555966', depthTest: true });
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), this.wheelMat);
    wheel.scale.set(0.016, 0.013, 0.036);
    wheel.position.set(0, onTop(0, ML * 0.44) + 0.005, ML * 0.44);
    wheel.renderOrder = 7;

    // Curved surface-hugging LMB (+X in cat-facing) & RMB (-X in cat-facing) highlight plates
    const makeBtnPatch = (sideSign: -1 | 1) => {
      const geo = new THREE.PlaneGeometry(1, 1, 8, 8);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) + 0.5;
        const v = pos.getY(i) + 0.5;
        const ang = (1 - v) * (Math.PI * 0.46);
        const rad = 0.08 + u * 0.85;
        const x = sideSign * Math.max(0.010, Math.cos(ang) * rad * MW * 0.92);
        const z = Math.max(0.004, Math.sin(ang) * rad * ML * 0.92);
        pos.setXYZ(i, x, onTop(x, z) + 0.004, z);
      }
      geo.computeVertexNormals();
      return geo;
    };

    this.leftBtnMat = new THREE.MeshBasicMaterial({
      color: '#d4f044',
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const leftBtn = new THREE.Mesh(makeBtnPatch(1), this.leftBtnMat);
    leftBtn.renderOrder = 5;
    leftBtn.visible = false;

    this.rightBtnMat = new THREE.MeshBasicMaterial({
      color: '#ff7b3b',
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rightBtn = new THREE.Mesh(makeBtnPatch(-1), this.rightBtnMat);
    rightBtn.renderOrder = 5;
    rightBtn.visible = false;

    this.mouseLabelLMat = new THREE.MeshBasicMaterial({
      map: makeMouseLabelTexture('L', true),
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.mouseLabelRMat = new THREE.MeshBasicMaterial({
      map: makeMouseLabelTexture('R', true),
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const lblGeo = new THREE.PlaneGeometry(0.068, 0.068);
    lblGeo.rotateX(-Math.PI / 2);
    const lblL = new THREE.Mesh(lblGeo, this.mouseLabelLMat);
    lblL.position.set(MW * 0.42, onTop(MW * 0.42, ML * 0.48) + 0.009, ML * 0.48);
    lblL.renderOrder = 8;
    const lblR = new THREE.Mesh(lblGeo, this.mouseLabelRMat);
    lblR.position.set(-MW * 0.42, onTop(-MW * 0.42, ML * 0.48) + 0.009, ML * 0.48);
    lblR.renderOrder = 8;

    this.mouseShape.add(
      mouseShadow,
      baseSkirt,
      dome,
      leftBtn,
      rightBtn,
      seamsMesh,
      wheel,
      lblL,
      lblR,
    );
    this.mouseShape.userData.leftBtn = leftBtn;
    this.mouseShape.userData.rightBtn = rightBtn;

    // Optional macOS Magic Trackpad (tapered aluminum wedge + glass surface + touch dots + click ripple)
    const padW = this.padWidth;
    const padD = this.padDepth;
    const padBase = makeRoundedSlabGeo(padW, padD, 0.036, 0.055, 0);
    const padBaseVerts = padBase.getAttribute('position');
    for (let i = 0; i < padBaseVerts.count; i++) {
      if (padBaseVerts.getY(i) < 0.001) {
        padBaseVerts.setY(i, 0.017 * (padBaseVerts.getZ(i) / padD + 0.5));
      }
    }
    const padGlass = makeRoundedSlabGeo(padW - 0.012, padD - 0.012, 0.006, 0.051, 0.036);
    const padPos = padGlass.getAttribute('position');
    const padGlassColors = new Float32Array(padPos.count * 3);
    const padPale = new THREE.Color('#fdfdfb');
    const padCool = new THREE.Color('#e5e9ec');
    const padShade = new THREE.Color();
    for (let i = 0; i < padPos.count; i++) {
      const t = 0.5 + 0.28 * (padPos.getZ(i) / padD) + 0.55 * (padPos.getX(i) / padW);
      padShade.copy(padPale).lerp(padCool, t).toArray(padGlassColors, i * 3);
    }
    padGlass.setAttribute('color', new THREE.BufferAttribute(padGlassColors, 3));
    const markerCanvas = document.createElement('canvas');
    markerCanvas.width = markerCanvas.height = 96;
    const markerCtx = markerCanvas.getContext('2d')!;
    markerCtx.translate(48, 48);
    drawClickMark(markerCtx, 46);
    const markerTex = new THREE.CanvasTexture(markerCanvas);
    markerTex.colorSpace = THREE.SRGBColorSpace;
    this.clickMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: markerTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.clickMarker.rotation.x = -Math.PI / 2;
    this.clickMarker.visible = false;
    this.clickMarker.renderOrder = 150;
    this.padGroup.add(
      new THREE.Mesh(padBase, new THREE.MeshBasicMaterial({ color: '#aeb5bb' })),
      new THREE.Mesh(padGlass, new THREE.MeshBasicMaterial({ vertexColors: true })),
      this.padDots,
      this.clickMarker,
    );
    this.padDots.count = 0;
    this.padDots.frustumCulled = false;
    this.padGroup.visible = false;
    this.mouseGroup.add(this.padGroup);
    this.deskGroup.add(this.mouseGroup);

    // Build Sleek 3D Drawing Tablet (4 left express keys + active slate pad + fading glowing strokes + stylus pen)
    this.tabletGroup.position.copy(this.tabletHome);
    this.tabletGroup.rotation.set(0.055, 0.04, 0);
    this.tabletGroup.visible = false;

    const TW = 0.56;
    const TD = 0.44;
    const TH = this.tabletThickness;

    const tabletShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(TW * 1.32, TD * 1.36),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.72 }),
    );
    tabletShadow.rotation.x = -Math.PI / 2;
    tabletShadow.position.set(0, 0.002, 0.015);

    const tBaseGeo = makeRoundedSlabGeo(TW, TD, TH * 0.82, 0.036, 0);
    const tBezelGeo = makeRoundedSlabGeo(TW - 0.012, TD - 0.012, TH * 0.24, 0.030, TH * 0.76);
    const tPadGeo = makeRoundedSlabGeo(this.tabletPadW, this.tabletPadD, 0.005, 0.016, TH - 0.002);
    tPadGeo.translate(this.tabletPadCenterX, 0, 0);

    const tabletParts: Array<{ geo: THREE.BufferGeometry; color: string }> = [
      { geo: tBaseGeo, color: '#1b1d24' },
      { geo: tBezelGeo, color: '#292d38' },
      { geo: tPadGeo, color: '#353a48' },
    ];
    // 4 tactile express keys down the left bezel (matching classic Wacom/Huion artist layout!)
    const keyZs = [-0.105, -0.032, 0.041, 0.114];
    for (const kz of keyZs) {
      const kGeo = makeRoundedSlabGeo(0.062, 0.050, 0.008, 0.010, TH);
      kGeo.translate(-0.214, 0, kz);
      tabletParts.push({ geo: kGeo, color: '#4d5466' });
    }
    const mergedTabletGeo = mergeStaticGeometries(tabletParts);
    for (const part of tabletParts) part.geo.dispose();
    const tabletBodyMesh = new THREE.Mesh(
      mergedTabletGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
    );

    // Status LED pill at top-left above express keys
    this.tabletLedMat = new THREE.MeshBasicMaterial({ color: '#4a5264' });
    const tabletLed = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.006, 0.012), this.tabletLedMat);
    tabletLed.position.set(-0.214, TH + 0.004, -0.174);

    // Live active drawing surface texture (subtle corner ticks + fading glowing strokes!)
    this.tabletPadCanvas = document.createElement('canvas');
    this.tabletPadCanvas.width = 256;
    this.tabletPadCanvas.height = 224;
    this.tabletPadCtx = this.tabletPadCanvas.getContext('2d')!;
    this.tabletPadTex = new THREE.CanvasTexture(this.tabletPadCanvas);
    this.tabletPadTex.colorSpace = THREE.SRGBColorSpace;
    this.redrawTabletPadCanvas();

    const padOverlayGeo = new THREE.PlaneGeometry(this.tabletPadW - 0.016, this.tabletPadD - 0.016);
    padOverlayGeo.rotateX(-Math.PI / 2);
    const padOverlayMesh = new THREE.Mesh(
      padOverlayGeo,
      new THREE.MeshBasicMaterial({
        map: this.tabletPadTex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    );
    padOverlayMesh.position.set(this.tabletPadCenterX, TH + 0.0055, 0);
    padOverlayMesh.renderOrder = 6;

    // 3D Stylus Pen anchored at the exact nib tip (0, 0, 0) so tilting keeps tip pinned to strokes!
    const nibTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.0015, 0.018, 10),
      new THREE.MeshBasicMaterial({ color: '#f3f5f8' }),
    );
    nibTip.position.y = 0.009;
    const nibCone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.004, 0.068, 14),
      new THREE.MeshBasicMaterial({ color: '#171920' }),
    );
    nibCone.position.y = 0.052;
    this.stylusRingMat = new THREE.MeshBasicMaterial({ color: '#d4f044' });
    const collarRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0205, 0.0195, 0.018, 14),
      this.stylusRingMat,
    );
    collarRing.position.y = 0.095;
    const gripBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.0205, 0.115, 14),
      new THREE.MeshBasicMaterial({ color: '#1f232c' }),
    );
    gripBand.position.y = 0.162;
    const sideBtn = new THREE.Mesh(
      new THREE.BoxGeometry(0.009, 0.064, 0.013),
      new THREE.MeshBasicMaterial({ color: '#6b7388' }),
    );
    sideBtn.position.set(0.019, 0.168, 0.004);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.023, 0.255, 14),
      new THREE.MeshBasicMaterial({ color: '#586075' }),
    );
    barrel.position.y = 0.346;
    const tailCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 14, 10),
      new THREE.MeshBasicMaterial({ color: '#a5b0c7' }),
    );
    tailCap.position.y = 0.474;
    this.stylusGroup.add(nibTip, nibCone, collarRing, gripBand, sideBtn, barrel, tailCap);
    this.stylusGroup.position.set(this.tabletPadCenterX, TH + 0.024, 0);
    this.stylusGroup.rotation.set(0.22, 0, -0.34);

    this.tabletGroup.add(tabletShadow, tabletBodyMesh, tabletLed, padOverlayMesh, this.stylusGroup);
    this.deskGroup.add(this.tabletGroup);

    // Build Sculpted 3D KuroCat Pro Gamepad (Plan A: flat-on-desk oversized Pro Controller, cat-facing)
    this.gamepadGroup.position.copy(this.gamepadHome);
    this.gamepadGroup.visible = false;

    const gpShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.24, 1.52),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.72 }),
    );
    gpShadow.rotation.x = -Math.PI / 2;
    gpShadow.position.set(0, 0.002, 0.04);
    this.gamepadGroup.add(gpShadow);

    // Rests flat & sturdy on the desk (matching keyboard desk tilt!) so cat paws press real sticks/buttons from above!
    this.gamepadBody.position.set(0, 0.015, 0.0);
    this.gamepadBody.rotation.set(0.12, 0, 0);
    this.gamepadBody.scale.setScalar(1.30);
    // Rotate 180° around Y so handles face the cat and LB/RB/LT/RT bumpers & triggers face outward toward the viewer!
    this.gamepadRig.rotation.y = Math.PI;
    this.gamepadBody.add(this.gamepadRig);
    this.gamepadGroup.add(this.gamepadBody);

    const GP_TOP = 0.145;
    const gpLowerGeo = new THREE.ExtrudeGeometry(makeGamepadContourShape(1.0, 1.0), {
      depth: 0.092,
      bevelEnabled: true,
      bevelThickness: 0.022,
      bevelSize: 0.020,
      bevelSegments: 3,
      curveSegments: 16,
    });
    gpLowerGeo.rotateX(Math.PI / 2);
    gpLowerGeo.translate(0, 0.118, 0);

    const gpFaceGeo = new THREE.ExtrudeGeometry(makeGamepadContourShape(0.94, 0.94), {
      depth: 0.022,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.011,
      bevelSegments: 2,
      curveSegments: 16,
    });
    gpFaceGeo.rotateX(Math.PI / 2);
    gpFaceGeo.translate(0, GP_TOP - 0.012, 0);

    // Sculpted charcoal side grip inlays on the outer handle flanks + subtle recessed D-pad well + stick sockets
    const gripLGeo = new THREE.CapsuleGeometry(0.056, 0.22, 6, 12);
    gripLGeo.rotateX(Math.PI / 2);
    gripLGeo.rotateY(-0.24);
    gripLGeo.scale(0.85, 0.55, 1.0);
    gripLGeo.translate(-0.555, GP_TOP - 0.032, 0.22);

    const gripRGeo = new THREE.CapsuleGeometry(0.056, 0.22, 6, 12);
    gripRGeo.rotateX(Math.PI / 2);
    gripRGeo.rotateY(0.24);
    gripRGeo.scale(0.85, 0.55, 1.0);
    gripRGeo.translate(0.555, GP_TOP - 0.032, 0.22);

    const socketWellL = new THREE.CylinderGeometry(0.114, 0.104, 0.012, 22);
    socketWellL.translate(-0.335, GP_TOP - 0.002, -0.045);
    const socketWellR = new THREE.CylinderGeometry(0.114, 0.104, 0.012, 22);
    socketWellR.translate(0.165, GP_TOP - 0.002, 0.105);

    const socketRimL = new THREE.TorusGeometry(0.116, 0.010, 8, 22);
    socketRimL.rotateX(Math.PI / 2);
    socketRimL.translate(-0.335, GP_TOP + 0.004, -0.045);
    const socketRimR = new THREE.TorusGeometry(0.116, 0.010, 8, 22);
    socketRimR.rotateX(Math.PI / 2);
    socketRimR.translate(0.165, GP_TOP + 0.004, 0.105);

    const dpadDish = new THREE.CylinderGeometry(0.112, 0.112, 0.006, 22);
    dpadDish.translate(-0.165, GP_TOP + 0.001, 0.105);
    const dpadHub = new THREE.BoxGeometry(0.056, 0.026, 0.056);
    dpadHub.translate(-0.165, GP_TOP + 0.014, 0.105);

    const homeBezel = new THREE.CylinderGeometry(0.044, 0.048, 0.010, 18);
    homeBezel.translate(0, GP_TOP + 0.005, -0.095);

    const gpStaticParts: Array<{ geo: THREE.BufferGeometry; color: string }> = [
      { geo: gpLowerGeo, color: '#222631' },
      { geo: gpFaceGeo, color: '#f3f2eb' },
      { geo: gripLGeo, color: '#2d3240' },
      { geo: gripRGeo, color: '#2d3240' },
      { geo: socketWellL, color: '#1b1f29' },
      { geo: socketWellR, color: '#1b1f29' },
      { geo: socketRimL, color: '#9ba5b8' },
      { geo: socketRimR, color: '#9ba5b8' },
      { geo: dpadDish, color: '#dad8cf' },
      { geo: dpadHub, color: '#242936' },
      { geo: homeBezel, color: '#252a36' },
    ];
    // Dark recessed collars under the 4 ABXY buttons
    const abxySpecs: Array<{
      bit: number;
      letter: 'A' | 'B' | 'X' | 'Y';
      dx: number;
      dz: number;
      bg: string;
      fg: string;
    }> = [
      { bit: GAMEPAD_BTN.A, letter: 'A', dx: 0, dz: 0.094, bg: '#22c55e', fg: '#ffffff' },
      { bit: GAMEPAD_BTN.B, letter: 'B', dx: 0.094, dz: 0, bg: '#ef4444', fg: '#ffffff' },
      { bit: GAMEPAD_BTN.X, letter: 'X', dx: -0.094, dz: 0, bg: '#3b82f6', fg: '#ffffff' },
      { bit: GAMEPAD_BTN.Y, letter: 'Y', dx: 0, dz: -0.094, bg: '#facc15', fg: '#1e222d' },
    ];
    for (const ab of abxySpecs) {
      const collar = new THREE.CylinderGeometry(0.048, 0.050, 0.008, 18);
      collar.translate(0.335 + ab.dx, GP_TOP + 0.003, -0.045 + ab.dz);
      gpStaticParts.push({ geo: collar, color: '#252a36' });
    }
    const mergedGpGeo = mergeStaticGeometries(gpStaticParts);
    for (const p of gpStaticParts) p.geo.dispose();
    const gpShellMesh = new THREE.Mesh(mergedGpGeo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.gamepadRig.add(gpShellMesh);

    // Center glowing KuroCat Home LED + BACK / START mini pills
    const homeLed = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, 0.012, 18), this.gpHomeLedMat);
    homeLed.position.set(0, GP_TOP + 0.009, -0.095);
    this.gamepadRig.add(homeLed);

    const makeMiniPill = (x: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: '#282d3a' });
      const geo = makeRoundedSlabGeo(0.056, 0.024, 0.016, 0.010, 0);
      const mesh = new THREE.Mesh(geo, mat);
      const baseY = GP_TOP + 0.002;
      mesh.position.set(x, baseY, -0.088);
      this.gamepadRig.add(mesh);
      return { mesh, mat, baseY };
    };
    this.gpBackBtn = makeMiniPill(-0.112);
    this.gpStartBtn = makeMiniPill(0.112);

    // Authentic Xbox Stacked Shoulders: centered USB-C port notch + curved upper Bumpers (LB/RB, Cyan)
    // + directly-underneath hinged curved Analog Triggers (LT/RT, Orange) + crisp press-time callout pills!
    const usbPortMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.022, 0.018),
      new THREE.MeshBasicMaterial({ color: '#141822' }),
    );
    usbPortMesh.position.set(0, GP_TOP - 0.044, -0.312);
    this.gamepadRig.add(usbPortMesh);

    const buildShoulderPair = (side: -1 | 1, bumperLabel: 'LB' | 'RB', triggerLabel: 'LT' | 'RT') => {
      // 1) Upper curved bumper hugging the ivory faceplate shoulder contour
      const bumperMat = new THREE.MeshBasicMaterial({ color: '#343c4e' });
      const bumperGroup = new THREE.Group();
      bumperGroup.position.set(0, GP_TOP + 0.002, -0.018);
      bumperGroup.add(new THREE.Mesh(makeGamepadCurvedBumperGeo(side), bumperMat));

      const bumperAccentMat = new THREE.MeshBasicMaterial({ color: '#58657f' });
      const bumperStrip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.008, 0.012), bumperAccentMat);
      bumperStrip.position.set(side * 0.315, -0.016, -0.314);
      bumperStrip.rotation.y = -side * 0.08;
      bumperGroup.add(bumperStrip);

      // 2) Lower hinged curved trigger directly underneath the bumper
      const triggerMat = new THREE.MeshBasicMaterial({ color: '#202634' });
      const triggerPivot = new THREE.Group();
      triggerPivot.position.set(0, GP_TOP - 0.050, -0.315);
      const triggerMesh = new THREE.Mesh(makeGamepadCurvedTriggerGeo(side), triggerMat);
      triggerMesh.rotation.x = 0.24;
      triggerPivot.add(triggerMesh);

      // 3) Clean press-time callout pills (hidden at rest, stack cleanly vertically if LB+LT or RB+RT held together!)
      const bBadgeGroup = new THREE.Group();
      bBadgeGroup.position.set(side * 0.335, GP_TOP + 0.052, -0.455);
      bBadgeGroup.rotation.set(0.42, 0, 0);
      bBadgeGroup.visible = false;
      const bBadgeGeo = new THREE.PlaneGeometry(0.28, 0.132);
      bBadgeGeo.rotateY(Math.PI);
      const bBadgeMat = new THREE.MeshBasicMaterial({
        map: makeGamepadShoulderPillTexture(bumperLabel, false),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const bBadgeMesh = new THREE.Mesh(bBadgeGeo, bBadgeMat);
      bBadgeMesh.renderOrder = 32;
      bBadgeGroup.add(bBadgeMesh);

      const tBadgeGroup = new THREE.Group();
      tBadgeGroup.position.set(side * 0.335, GP_TOP + 0.015, -0.495);
      tBadgeGroup.rotation.set(0.42, 0, 0);
      tBadgeGroup.visible = false;
      const tBadgeGeo = new THREE.PlaneGeometry(0.30, 0.144);
      tBadgeGeo.rotateY(Math.PI);
      const tBadgeMat = new THREE.MeshBasicMaterial({
        map: makeGamepadShoulderPillTexture(triggerLabel, true),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const tBadgeMesh = new THREE.Mesh(tBadgeGeo, tBadgeMat);
      tBadgeMesh.renderOrder = 33;
      tBadgeGroup.add(tBadgeMesh);

      const trackGeo = new THREE.PlaneGeometry(0.20, 0.019);
      trackGeo.rotateY(Math.PI);
      const trackMesh = new THREE.Mesh(
        trackGeo,
        new THREE.MeshBasicMaterial({
          color: '#431407',
          transparent: true,
          opacity: 0.80,
          depthTest: false,
          depthWrite: false,
        }),
      );
      trackMesh.position.set(0, -0.044, -0.002);
      trackMesh.renderOrder = 34;
      tBadgeGroup.add(trackMesh);

      const fillGeo = new THREE.PlaneGeometry(0.192, 0.013);
      fillGeo.rotateY(Math.PI);
      const tGaugeFill = new THREE.Mesh(
        fillGeo,
        new THREE.MeshBasicMaterial({
          color: '#fef08a',
          transparent: true,
          opacity: 0.96,
          depthTest: false,
          depthWrite: false,
        }),
      );
      tGaugeFill.position.set(0, -0.044, -0.003);
      tGaugeFill.renderOrder = 35;
      tBadgeGroup.add(tGaugeFill);

      this.gamepadRig.add(bumperGroup, triggerPivot, bBadgeGroup, tBadgeGroup);
      return {
        side,
        bumperGroup,
        bumperMat,
        bumperAccentMat,
        triggerPivot,
        triggerMat,
        bBadgeGroup,
        bBadgeMat,
        tBadgeGroup,
        tBadgeMat,
        tGaugeFill,
      };
    };

    // Screen-RIGHT side (cat's LEFT hand, Left Stick side): LB + LT stacked
    this.gpShoulderL = buildShoulderPair(-1, 'LB', 'LT');
    // Screen-LEFT side (cat's RIGHT hand, ABXY side): RB + RT stacked
    this.gpShoulderR = buildShoulderPair(1, 'RB', 'RT');

    // Twin Pivoting Concave Analog Thumbsticks
    const populateStick = (group: THREE.Group, rimMat: THREE.MeshBasicMaterial, x: number, z: number) => {
      group.position.set(x, GP_TOP - 0.008, z);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.032, 0.066, 14),
        new THREE.MeshBasicMaterial({ color: '#1b1f29' }),
      );
      stem.position.y = 0.034;
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.088, 0.072, 0.030, 20),
        new THREE.MeshBasicMaterial({ color: '#2b3140' }),
      );
      cap.position.y = 0.072;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.013, 8, 22), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.086;
      const innerDish = new THREE.Mesh(
        new THREE.CylinderGeometry(0.064, 0.064, 0.006, 18),
        new THREE.MeshBasicMaterial({ color: '#212633' }),
      );
      innerDish.position.y = 0.085;
      group.add(stem, cap, rim, innerDish);
      this.gamepadRig.add(group);
    };
    populateStick(this.gpLeftStick, this.gpLeftStickCapMat, -0.335, -0.045);
    populateStick(this.gpRightStick, this.gpRightStickCapMat, 0.165, 0.105);

    // 4-Way Cross D-Pad Arms
    const makeDpadArm = (dx: number, dz: number, w: number, d: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: '#282d3a' });
      const geo = makeRoundedSlabGeo(w, d, 0.028, 0.010, 0);
      const mesh = new THREE.Mesh(geo, mat);
      const baseY = GP_TOP + 0.002;
      mesh.position.set(-0.165 + dx, baseY, 0.105 + dz);
      this.gamepadRig.add(mesh);
      return { mesh, mat, baseY };
    };
    this.gpDpadMeshes = {
      up: makeDpadArm(0, -0.055, 0.056, 0.064),
      down: makeDpadArm(0, 0.055, 0.056, 0.064),
      left: makeDpadArm(-0.055, 0, 0.064, 0.056),
      right: makeDpadArm(0.055, 0, 0.064, 0.056),
    };

    // Diamond ABXY Buttons with crisp letter caps
    const abxySideGeo = new THREE.CylinderGeometry(0.041, 0.043, 0.032, 18);
    const abxyTopGeo = new THREE.CircleGeometry(0.039, 18);
    abxyTopGeo.rotateX(-Math.PI / 2);
    for (const ab of abxySpecs) {
      const group = new THREE.Group();
      const baseY = GP_TOP + 0.018;
      group.position.set(0.335 + ab.dx, baseY, -0.045 + ab.dz);
      const sideMat = new THREE.MeshBasicMaterial({ color: ab.bg });
      const topMat = new THREE.MeshBasicMaterial({
        map: makeGamepadBtnLetterTexture(ab.letter, ab.bg, ab.fg),
        color: '#ffffff',
      });
      const cyl = new THREE.Mesh(abxySideGeo.clone(), sideMat);
      const top = new THREE.Mesh(abxyTopGeo.clone(), topMat);
      top.position.y = 0.0165;
      group.add(cyl, top);
      this.gamepadRig.add(group);
      this.gpFaceBtns.push({
        bit: ab.bit,
        group,
        sideMat,
        topMat,
        baseColor: new THREE.Color(ab.bg),
        baseY,
      });
    }
    abxySideGeo.dispose();
    abxyTopGeo.dispose();

    this.deskGroup.add(this.gamepadGroup);

    scene.add(this.deskGroup);
    this.rebuildBoard('65', 'cat');
  }

  private syncDeskVisibility(): void {
    this.boardGroup.visible = !this.gamepadActive;
    this.mouseGroup.visible = !this.gamepadActive && !this.tabletActive;
    this.tabletGroup.visible = !this.gamepadActive && this.tabletActive;
    this.gamepadGroup.visible = this.gamepadActive;
  }

  public setGamepadActive(active: boolean): void {
    const next = Boolean(active);
    if (this.gamepadActive === next) return;
    this.gamepadActive = next;
    if (!next) {
      this.gpTarget = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0 };
    }
    this.syncDeskVisibility();
  }

  public setGamepadHome(x: number, z: number): void {
    this.gamepadHome.set(x, 0.015, z);
    this.gamepadGroup.position.copy(this.gamepadHome);
  }

  public isGamepadActive(): boolean {
    return this.gamepadActive;
  }

  public setGamepadState(state: GamepadInputState): void {
    const nextBtns = (Number(state.buttons) || 0) & 0xffff;
    const newlyPressed = nextBtns & ~this.gpPrevButtons;
    this.gpPrevButtons = nextBtns;

    const nextLt = clamp(Number(state.lt) || 0, 0, 1);
    const nextRt = clamp(Number(state.rt) || 0, 0, 1);
    const ltNow = nextLt > 0.18;
    const rtNow = nextRt > 0.18;
    const ltNew = ltNow && !this.gpPrevLtActive;
    const rtNew = rtNow && !this.gpPrevRtActive;
    this.gpPrevLtActive = ltNow;
    this.gpPrevRtActive = rtNow;

    if ((newlyPressed & (GAMEPAD_BTN.A | GAMEPAD_BTN.B | GAMEPAD_BTN.X | GAMEPAD_BTN.Y | GAMEPAD_BTN.RB)) !== 0 || rtNew) {
      this.gpTapL = 1;
      this.gpBounce = Math.min(1, this.gpBounce + 0.55);
    }
    if ((newlyPressed & (GAMEPAD_BTN.UP | GAMEPAD_BTN.DOWN | GAMEPAD_BTN.LEFT | GAMEPAD_BTN.RIGHT | GAMEPAD_BTN.LB)) !== 0 || ltNew) {
      this.gpTapR = 1;
      this.gpBounce = Math.min(1, this.gpBounce + 0.55);
    }

    this.gpTarget.lx = clamp(Number(state.lx) || 0, -1, 1);
    this.gpTarget.ly = clamp(Number(state.ly) || 0, -1, 1);
    this.gpTarget.rx = clamp(Number(state.rx) || 0, -1, 1);
    this.gpTarget.ry = clamp(Number(state.ry) || 0, -1, 1);
    this.gpTarget.lt = nextLt;
    this.gpTarget.rt = nextRt;
    this.gpTarget.buttons = nextBtns;
  }

  /**
   * Plan A (flat-on-desk oversized gamepad + real paw-on-stick / paw-on-ABXY + signature cat tail 3rd hand!):
   * - `leftOut` (screen-left paw `paws.L`, cat's RIGHT hand) directly presses ABXY buttons, pushes Right Stick, or hits RB/RT!
   * - `rightOut` (screen-right paw `paws.R`, cat's LEFT hand) directly pushes Left Stick cap, slaps D-Pad arms, or hits LB/LT!
   * - `tailOut` (signature 3rd hand!) whips onto LT/LB, RT/RB, D-Pad (when Left Stick busy), Right Stick (when ABXY busy), or START/BACK!
   */
  public gamepadLimbTargets(
    leftOut: THREE.Vector3,
    rightOut: THREE.Vector3,
    tailOut: THREE.Vector3,
  ): { tailActive: boolean; leftPressed: boolean; rightPressed: boolean } {
    this.deskGroup.updateMatrixWorld(false);
    this.gamepadGroup.updateMatrixWorld(false);
    this.gamepadBody.updateMatrixWorld(false);
    this.gamepadRig.updateMatrixWorld(false);
    this.gpLeftStick.updateMatrixWorld(false);
    this.gpRightStick.updateMatrixWorld(false);

    const GP_TOP = 0.145;
    const btns = this.gpTarget.buttons;
    const lsActive = Math.hypot(this.gpSmLx, this.gpSmLy) > 0.05;
    const rsActive = Math.hypot(this.gpSmRx, this.gpSmRy) > 0.05;
    const dpadBits = btns & (GAMEPAD_BTN.UP | GAMEPAD_BTN.DOWN | GAMEPAD_BTN.LEFT | GAMEPAD_BTN.RIGHT);
    const dpadActive = dpadBits !== 0;
    const abxyBits = btns & (GAMEPAD_BTN.A | GAMEPAD_BTN.B | GAMEPAD_BTN.X | GAMEPAD_BTN.Y);
    const abxyActive = abxyBits !== 0;
    const lbActive = (btns & GAMEPAD_BTN.LB) !== 0;
    const rbActive = (btns & GAMEPAD_BTN.RB) !== 0;
    const ltActive = this.gpSmLt > 0.08;
    const rtActive = this.gpSmRt > 0.08;
    const menuBits = btns & (GAMEPAD_BTN.START | GAMEPAD_BTN.BACK);

    // Helper: compute exact D-Pad pressed arm coordinates in gamepadRig local space
    const dpadLocal = (out: THREE.Vector3) => {
      let dx = 0;
      let dz = 0;
      let n = 0;
      if (btns & GAMEPAD_BTN.UP) { dz -= 0.058; n++; }
      if (btns & GAMEPAD_BTN.DOWN) { dz += 0.058; n++; }
      if (btns & GAMEPAD_BTN.LEFT) { dx -= 0.058; n++; }
      if (btns & GAMEPAD_BTN.RIGHT) { dx += 0.058; n++; }
      if (n > 0) { dx /= n; dz /= n; }
      return out.set(-0.165 + dx, GP_TOP + 0.044, 0.105 + dz);
    };

    // Helper: compute exact ABXY pressed button (or multi-button chord midpoint!) in gamepadRig local space
    const abxyLocal = (out: THREE.Vector3) => {
      let dx = 0;
      let dz = 0;
      let n = 0;
      if (btns & GAMEPAD_BTN.A) { dz += 0.094; n++; }
      if (btns & GAMEPAD_BTN.B) { dx += 0.094; n++; }
      if (btns & GAMEPAD_BTN.X) { dx -= 0.094; n++; }
      if (btns & GAMEPAD_BTN.Y) { dz -= 0.094; n++; }
      if (n > 0) { dx /= n; dz /= n; }
      return out.set(0.335 + dx, GP_TOP + 0.048, -0.045 + dz);
    };

    // 1) Screen-RIGHT paw (`rightOut`, cat's LEFT hand): owns Left Stick (-0.335) / D-Pad (-0.165) / LB·LT (-0.37)
    let rightPressed = false;
    let rightBusyOnFace = false;
    if (lsActive) {
      rightOut.set(0, 0.112, 0).applyMatrix4(this.gpLeftStick.matrixWorld);
      rightPressed = true;
      rightBusyOnFace = true;
    } else if (dpadActive) {
      const hop = Math.sin(this.gpTapR * Math.PI) * 0.085;
      dpadLocal(rightOut);
      rightOut.y += hop;
      rightOut.applyMatrix4(this.gamepadRig.matrixWorld);
      rightPressed = true;
      rightBusyOnFace = true;
    } else if (lbActive || ltActive) {
      const hop = Math.sin(this.gpTapR * Math.PI) * 0.06;
      const aimLt = ltActive && !lbActive;
      rightOut
        .set(-0.335, GP_TOP + (aimLt ? -0.010 : 0.025) + hop, aimLt ? -0.370 : -0.308)
        .applyMatrix4(this.gamepadRig.matrixWorld);
      rightPressed = true;
    } else {
      // Cozy ready poise resting lightly on the Left Stick shoulder edge
      rightOut.set(-0.36, GP_TOP + 0.095, 0.06).applyMatrix4(this.gamepadRig.matrixWorld);
    }

    // 2) Screen-LEFT paw (`leftOut`, cat's RIGHT hand): owns ABXY (+0.335) / Right Stick (+0.165) / stacked RB·RT (+0.335)
    let leftPressed = false;
    let leftBusyOnFace = false;
    if (abxyActive) {
      const hop = Math.sin(this.gpTapL * Math.PI) * 0.095;
      abxyLocal(leftOut);
      leftOut.y += hop;
      leftOut.applyMatrix4(this.gamepadRig.matrixWorld);
      leftPressed = true;
      leftBusyOnFace = true;
    } else if (rsActive) {
      leftOut.set(0, 0.112, 0).applyMatrix4(this.gpRightStick.matrixWorld);
      leftPressed = true;
      leftBusyOnFace = true;
    } else if (rbActive || rtActive) {
      const hop = Math.sin(this.gpTapL * Math.PI) * 0.06;
      const aimRt = rtActive && !rbActive;
      leftOut
        .set(0.335, GP_TOP + (aimRt ? -0.010 : 0.025) + hop, aimRt ? -0.370 : -0.308)
        .applyMatrix4(this.gamepadRig.matrixWorld);
      leftPressed = true;
    } else {
      // Cozy ready poise hovering lightly beside ABXY
      leftOut.set(0.36, GP_TOP + 0.075, 0.06).applyMatrix4(this.gamepadRig.matrixWorld);
    }

    // 3) Signature KuroCat Tail (Third Hand!): whips in whenever a 3rd+ simultaneous control fires!
    let tailActive = false;
    if ((ltActive || lbActive) && (rightBusyOnFace || leftBusyOnFace)) {
      // Tail slaps screen-RIGHT stacked trigger (LT) or bumper (LB) while paws stay on sticks/ABXY!
      tailOut
        .set(-0.335, GP_TOP + (ltActive ? -0.012 : 0.025), ltActive ? -0.382 : -0.312)
        .applyMatrix4(this.gamepadRig.matrixWorld);
      tailActive = true;
    } else if ((rtActive || rbActive) && leftBusyOnFace) {
      // Tail sweeps across front edge to slam screen-LEFT stacked trigger (RT) or bumper (RB)!
      tailOut
        .set(0.335, GP_TOP + (rtActive ? -0.012 : 0.025), rtActive ? -0.382 : -0.312)
        .applyMatrix4(this.gamepadRig.matrixWorld);
      tailActive = true;
    } else if (dpadActive && lsActive) {
      // Classic Souls/MH claw-grip: Right Paw steers Left Stick while Tail taps D-Pad!
      dpadLocal(tailOut).applyMatrix4(this.gamepadRig.matrixWorld);
      tailActive = true;
    } else if (rsActive && abxyActive) {
      // Classic claw-grip: Left Paw smashes ABXY while Tail nudges the Right Stick camera!
      tailOut.set(0, 0.112, 0).applyMatrix4(this.gpRightStick.matrixWorld);
      tailActive = true;
    } else if (menuBits !== 0) {
      const mx = (menuBits & GAMEPAD_BTN.START) !== 0 ? 0.112 : -0.112;
      tailOut.set(mx, GP_TOP + 0.026, -0.088).applyMatrix4(this.gamepadRig.matrixWorld);
      tailActive = true;
    }

    return { tailActive, leftPressed, rightPressed };
  }

  public setTabletActive(active: boolean): void {
    const next = Boolean(active);
    if (this.tabletActive === next) return;
    this.tabletActive = next;
    this.syncDeskVisibility();
    if (!next) {
      this.tabletStrokes.length = 0;
      this.tabletWasDrawing = false;
      this.tabletPadDirty = true;
    } else {
      this.tabletPadDirty = true;
      this.redrawTabletPadCanvas();
    }
  }

  public isTabletActive(): boolean {
    return this.tabletActive;
  }

  private redrawTabletPadCanvas(): void {
    const c = this.tabletPadCanvas;
    const g = this.tabletPadCtx;
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);

    // Subtle crisp corner crop marks so the active drawing area reads cleanly at any scale
    g.strokeStyle = 'rgba(218, 226, 245, 0.34)';
    g.lineWidth = 3.2;
    g.lineCap = 'round';
    const m = 12;
    const len = 14;
    const corners: Array<[number, number, number, number]> = [
      [m, m, 1, 1],
      [w - m, m, -1, 1],
      [m, h - m, 1, -1],
      [w - m, h - m, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      g.beginPath();
      g.moveTo(cx + sx * len, cy);
      g.lineTo(cx, cy);
      g.lineTo(cx, cy + sy * len);
      g.stroke();
    }

    if (this.tabletStrokes.length > 1) {
      const hex = `#${this.hitColor.getHexString()}`;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (let i = 1; i < this.tabletStrokes.length; i++) {
        const p0 = this.tabletStrokes[i - 1];
        const p1 = this.tabletStrokes[i];
        if (p1.breakLine) continue;
        const age = this.tabletClock - p1.t;
        const alpha = Math.max(0, 1 - age / 1.35);
        if (alpha <= 0.01) continue;
        const x0 = p0.u * w;
        const y0 = p0.v * h;
        const x1 = p1.u * w;
        const y1 = p1.v * h;
        // Soft luminous outer stroke
        g.globalAlpha = alpha * 0.42;
        g.strokeStyle = hex;
        g.lineWidth = 9.5;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        // Crisp glowing core stroke
        g.globalAlpha = alpha * 0.96;
        g.strokeStyle = hex;
        g.lineWidth = 4.2;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    this.tabletPadTex.needsUpdate = true;
    this.tabletPadDirty = false;
  }

  public setAccentColors(primaryHex: string, rightHex: string): void {
    this.hitColor.set(primaryHex);
    this.rightBtnColor.set(rightHex);
    this.leftBtnMat.color.set(primaryHex);
    this.rightBtnMat.color.set(rightHex);
    this.stylusRingMat.color.set(primaryHex);
    this.tabletPadDirty = true;
  }

  public setStyle(style: '3d' | '2d'): void {
    const is3D = style === '3d';
    this.mouseBodyMat.vertexColors = is3D;
    this.mouseBodyMat.color.set(is3D ? '#ffffff' : '#f4f4f0');
    this.mouseBodyMat.needsUpdate = true;
  }

  public setTrackpad(enabled: boolean): void {
    this.pad.setEnabled(enabled);
    this.padGroup.visible = enabled;
    this.mouseShape.visible = !enabled;
    if (!enabled) this.padDots.count = 0;
  }

  public setContacts(points: readonly PadPoint[]): void {
    if (!this.pad.enabled) return;
    this.pad.points = points;
    this.padDots.count = Math.min(16, points.length);
    for (let i = 0; i < this.padDots.count; i++) {
      const p = padPosition(points[i], false, this.padWidth * PAD_USABLE, this.padDepth * PAD_USABLE);
      this.padDots.setMatrixAt(i, this.dotMatrix.makeTranslation(p.x, 0.044, p.y));
    }
    this.padDots.instanceMatrix.needsUpdate = true;
  }

  public rebuildBoard(layoutId: KeyboardLayoutId, orientation: KeyboardOrientation, white = false): void {
    white = white && layoutId === 'macbook';
    // Skip redundant rebuild if nothing changed and meshes already exist
    if (
      this.sideInstanced &&
      this.layoutId === layoutId &&
      this.orientation === orientation &&
      this.whiteKeyboard === white
    ) {
      return;
    }

    this.whiteKeyboard = white;
    const finish = macbookFinishes[white ? 'white' : 'black'];
    this.macSideColor.set(white ? finish.side : '#18191c');
    this.layoutId = layoutId;
    this.orientation = orientation;
    this.keys.clear();
    this.keysByIndex.length = 0;
    this.activeKeys.clear();

    while (this.boardGroup.children.length > 0) {
      this.boardGroup.remove(this.boardGroup.children[0]);
    }
    for (const d of this.boardDisposables) {
      d.dispose();
    }
    this.boardDisposables.length = 0;

    const layout = getKeyboardLayout(layoutId);
    const mac = layoutId === 'macbook';
    const isCatFacing = orientation === 'cat';

    this.padGroup.quaternion.copy(this.boardGroup.quaternion);
    if (isCatFacing) this.padGroup.rotateY(Math.PI);

    // Keep mouse cat-facing in both keyboard orientations (#92) so the paw rests on the palm heel without covering RMB
    this.mouseShape.rotation.y = -0.10;
    this.mouseLabelLMat.map = makeMouseLabelTexture('L', true);
    this.mouseLabelRMat.map = makeMouseLabelTexture('R', true);
    this.mouseLabelLMat.needsUpdate = true;
    this.mouseLabelRMat.needsUpdate = true;

    const U = layoutId === '108' ? 0.122 : layoutId === '98' ? 0.134 : 0.150;
    const CAP = U * (mac ? 0.92 : 0.87);
    const W = layout.totalUnits * U + 0.14;
    const D = layout.totalRows * U + 0.14;
    this.boardWidth = W;
    this.boardH = mac ? 0.042 : 0.112;
    this.capH = mac ? 0.016 : layoutId === '108' ? 0.048 : layoutId === '98' ? 0.052 : 0.056;

    this.boardGroup.position.set(0.24, 0.015, 1.08);
    this.padHome
      .set(-(W + this.padWidth) / 2 - 0.052, 0, padCenterDepth(D, this.padDepth))
      .applyQuaternion(this.boardGroup.quaternion)
      .add(this.boardGroup.position);
    this.mouseHome.set(
      layoutId === '108' ? -1.46 : layoutId === '98' ? -1.32 : -1.16,
      0.015,
      0.96,
    );
    this.tabletHome.set(
      layoutId === '108' ? -1.56 : layoutId === '98' ? -1.42 : -1.26,
      0.015,
      1.03,
    );
    this.tabletGroup.position.copy(this.tabletHome);

    // Soft grounded desk shadow under keyboard
    const kbShadowGeo = new THREE.PlaneGeometry(W * 1.18, D * 1.38);
    const kbShadow = new THREE.Mesh(kbShadowGeo, this.kbShadowMat);
    kbShadow.rotation.x = -Math.PI / 2;
    kbShadow.position.set(0, 0.002, 0.025);
    this.boardDisposables.push(kbShadowGeo);

    // Merge baseChassis + topBezel + plate into 1 single vertex-colored draw call!
    const baseGeo = makeRoundedSlabGeo(W, D, this.boardH, 0.068, 0);
    const bezelGeo = makeRoundedSlabGeo(W - 0.014, D - 0.014, 0.014, 0.060, this.boardH - 0.008);
    const plateGeo = makeRoundedSlabGeo(W - 0.062, D - 0.062, 0.008, 0.044, this.boardH + 0.004);
    const chassisGeo = mergeStaticGeometries([
      { geo: baseGeo, color: mac ? finish.base : '#202229' },
      { geo: bezelGeo, color: mac ? finish.bezel : '#2c2f38' },
      { geo: plateGeo, color: mac ? finish.plate : '#181a20' },
    ]);
    if (mac) {
      // Bake a broad anodized-aluminum highlight into the shared chassis vertex colors.
      const position = chassisGeo.attributes.position;
      const color = chassisGeo.attributes.color;
      for (let i = 0; i < color.count; i++) {
        const light = 0.94 + (0.20 * position.getX(i)) / W - (0.15 * position.getZ(i)) / D;
        color.setXYZ(i, color.getX(i) * light, color.getY(i) * light, color.getZ(i) * light);
      }
    }
    baseGeo.dispose();
    bezelGeo.dispose();
    plateGeo.dispose();
    const chassisMesh = new THREE.Mesh(chassisGeo, this.chassisMat);
    this.boardDisposables.push(chassisGeo);
    this.boardGroup.add(kbShadow, chassisMesh);

    // Single Texture Atlas + 2 InstancedMeshes for ALL keycaps (2 draw calls total!)
    const keyCount = layout.keys.length;
    const atlas = getKeycapAtlas(layoutId, layout.keys, isCatFacing, white);

    const chiclet = mac ? makeChicletGeometry() : null;
    if (chiclet) this.boardDisposables.push(chiclet.side);
    const sideInst = new THREE.InstancedMesh(chiclet?.side ?? this.capSideGeo, this.capSideMat, keyCount);
    sideInst.frustumCulled = false;

    const topGeo = chiclet?.top ?? this.capTopBaseGeo.clone();
    const uvRects = new Float32Array(keyCount * 4);
    const tints = new Float32Array(keyCount * 3);
    const uvAttr = new THREE.InstancedBufferAttribute(uvRects, 4);
    const tintAttr = new THREE.InstancedBufferAttribute(tints, 3);
    tintAttr.setUsage(THREE.DynamicDrawUsage);
    topGeo.setAttribute('aUvRect', uvAttr);
    topGeo.setAttribute('aTint', tintAttr);

    const topMat = createInstancedKeyTopMaterial(atlas.tex);
    const topInst = new THREE.InstancedMesh(topGeo, topMat, keyCount);
    topInst.frustumCulled = false;
    this.boardDisposables.push(sideInst, topInst, topGeo, topMat);

    const baseY = this.boardH + 0.008;
    for (let i = 0; i < keyCount; i++) {
      const spec = layout.keys[i];
      const rY = spec.rowY ?? spec.row;
      const rSpan = spec.rowSpan ?? 1;
      const uCenter = spec.uStart + spec.uWidth * 0.5;
      const rCenter = rY + rSpan * 0.5;

      const screenU = isCatFacing ? layout.totalUnits - uCenter : uCenter;
      const screenR = isCatFacing ? layout.totalRows - rCenter : rCenter;

      const x = (screenU - layout.totalUnits * 0.5) * U;
      const z = (screenR - layout.totalRows * 0.5) * U;
      const scaleX = Math.max(0.06, spec.uWidth * U - (U - CAP));
      const scaleY = this.capH;
      const scaleZ = Math.max(0.06, rSpan * U - (U - CAP));

      this.tmpPos.set(x, baseY, z);
      this.tmpScale.set(scaleX, scaleY, scaleZ);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      sideInst.setMatrixAt(i, this.tmpMat);
      topInst.setMatrixAt(i, this.tmpMat);

      const accent: 'base' | 'mod' | 'orange' =
        spec.accent === 'orange' ? 'orange' : spec.accent === 'mod' ? 'mod' : 'base';
      sideInst.setColorAt(
        i,
        mac
          ? this.macSideColor
          : accent === 'orange'
            ? this.sideColorOrange
            : accent === 'mod'
              ? this.sideColorMod
              : this.sideColorBase,
      );

      const legendText = spec.id === 'space' ? '' : spec.id === 'esc' ? 'Esc' : spec.label;
      const rect = atlas.rects.get(mac ? spec.id : `${legendText}|${accent}`) ?? [0, 0, 0.1, 0.1];
      uvRects[i * 4] = rect[0];
      uvRects[i * 4 + 1] = rect[1];
      uvRects[i * 4 + 2] = rect[2];
      uvRects[i * 4 + 3] = rect[3];

      tints[i * 3] = 1;
      tints[i * 3 + 1] = 1;
      tints[i * 3 + 2] = 1;

      const entry: KeyEntry3D = {
        spec,
        index: i,
        x,
        z,
        scaleX,
        scaleY,
        scaleZ,
        down: false,
        depth: 0,
        glow: 0,
      };
      this.keys.set(spec.id, entry);
      this.keysByIndex.push(entry);
    }

    sideInst.instanceMatrix.needsUpdate = true;
    if (sideInst.instanceColor) sideInst.instanceColor.needsUpdate = true;
    topInst.instanceMatrix.needsUpdate = true;
    this.sideInstanced = sideInst;
    this.topInstanced = topInst;
    this.topTintAttr = tintAttr;
    this.topTintArray = tints;
    this.boardGroup.add(sideInst, topInst);

    // Privacy dark frosted shield over the 3D keyboard
    const privGeo = new THREE.PlaneGeometry(W - 0.08, D - 0.08);
    this.boardDisposables.push(privGeo);
    this.privacyPlate = new THREE.Mesh(privGeo, this.privacyMat);
    this.privacyPlate.rotation.x = -Math.PI / 2;
    this.privacyPlate.position.set(0, this.boardH + this.capH + 0.025, 0);
    this.privacyPlate.renderOrder = 30;
    this.privacyPlate.visible = false;
    this.boardGroup.add(this.privacyPlate);

    this.deskGroup.updateMatrixWorld(false);
    this.boardGroup.updateMatrixWorld(false);
  }

  public getLayoutId(): KeyboardLayoutId {
    return this.layoutId;
  }

  public getOrientation(): KeyboardOrientation {
    return this.orientation;
  }

  public getBoardWidth(): number {
    return this.boardWidth;
  }

  public resolveKey(vk: number): KeyEntry3D | null {
    const spec = resolveKeyByVk(vk, this.layoutId);
    if (!spec) return null;
    return this.keys.get(spec.id) || null;
  }

  public getKeyById(id: string): KeyEntry3D | null {
    return this.keys.get(id) || null;
  }

  public hitTestKey(raycaster: THREE.Raycaster): KeySpec | null {
    if (
      this.gamepadActive ||
      !this.boardGroup.visible ||
      !this.topInstanced ||
      !this.sideInstanced ||
      this.keysByIndex.length === 0
    ) {
      return null;
    }
    if (this.privacyPlate?.visible && this.privacyMat.opacity > 0.15) {
      return null;
    }
    this.deskGroup.updateMatrixWorld(false);
    this.boardGroup.updateMatrixWorld(true);

    const hits = raycaster.intersectObjects([this.topInstanced, this.sideInstanced], false);
    for (let i = 0; i < hits.length; i++) {
      const idx = hits[i].instanceId;
      if (typeof idx === 'number') {
        const entry = this.keysByIndex[idx];
        if (entry && entry.spec.vkCodes.length > 0) return entry.spec;
      }
    }

    // Narrow bevel-gap forgiveness on the board plane so clicking between adjacent keycaps stays responsive
    this.hitInvMat.copy(this.boardGroup.matrixWorld).invert();
    this.hitLocalRay.copy(raycaster.ray).applyMatrix4(this.hitInvMat);
    this.hitPlane.constant = -(this.boardH + 0.008 + this.capH * 0.65);
    if (!this.hitLocalRay.intersectPlane(this.hitPlane, this.hitPt)) {
      return null;
    }
    const px = this.hitPt.x;
    const pz = this.hitPt.z;
    const pad = 0.016;
    let best: KeyEntry3D | null = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < this.keysByIndex.length; i++) {
      const entry = this.keysByIndex[i];
      if (entry.spec.vkCodes.length === 0) continue;
      const halfW = entry.scaleX * 0.5 + pad;
      const halfD = entry.scaleZ * 0.5 + pad;
      if (Math.abs(px - entry.x) <= halfW && Math.abs(pz - entry.z) <= halfD) {
        const dSq = (px - entry.x) ** 2 + (pz - entry.z) ** 2;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          best = entry;
        }
      }
    }
    return best ? best.spec : null;
  }

  public setKeyDown(id: string, down: boolean): void {
    const k = this.keys.get(id);
    if (!k) return;
    if (k.down !== down) {
      k.down = down;
      this.activeKeys.add(k);
    } else if (down) {
      this.activeKeys.add(k);
    }
  }

  public releaseAllKeys(): void {
    for (const k of this.keys.values()) {
      if (k.down) {
        k.down = false;
        this.activeKeys.add(k);
      }
    }
  }

  public keyTopWorld(id: string, out = new THREE.Vector3()): THREE.Vector3 {
    const k = this.keys.get(id);
    this.deskGroup.updateMatrixWorld(false);
    this.boardGroup.updateMatrixWorld(false);
    if (!k) return out.set(0.24, this.boardH + this.capH, 1.08);
    return out
      .set(k.x, this.boardH + 0.008 + this.capH - k.depth, k.z)
      .applyMatrix4(this.boardGroup.matrixWorld);
  }

  public isRightEdgeTailKey(id: string): boolean {
    const k = this.keys.get(id);
    if (!k) return false;
    return k.x >= this.boardWidth * 0.22;
  }

  public setMouseNormalized(nx: number, ny: number): void {
    const cx = clamp(nx, 0, 1);
    const cy = clamp(ny, 0, 1);
    this.mouseTarget.set((cx - 0.5) * 0.22, 0, (cy - 0.5) * 0.14);
    const padHalfW = (this.tabletPadW - 0.06) * 0.5;
    const padHalfD = (this.tabletPadD - 0.06) * 0.5;
    this.tabletPenTarget.set(
      this.tabletPadCenterX + (cx - 0.5) * 2 * padHalfW,
      0,
      (cy - 0.5) * 2 * padHalfD,
    );
  }

  public pulseScrollWheel(): void {
    this.wheelGlow = 1;
  }

  public mouseTopWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.deskGroup.updateMatrixWorld(false);
    if (this.tabletActive) {
      this.tabletGroup.updateMatrixWorld(false);
      this.stylusGroup.updateMatrixWorld(false);
      return out.set(0, 0.165, 0).applyMatrix4(this.stylusGroup.matrixWorld);
    }
    this.mouseGroup.updateMatrixWorld(false);
    if (this.pad.enabled) {
      const p = padPosition(this.pad.target, false, this.padWidth * PAD_USABLE, this.padDepth * PAD_USABLE);
      this.padGroup.updateWorldMatrix(true, false);
      return out.set(p.x, this.pad.pressed ? 0.047 : 0.067, p.y).applyMatrix4(this.padGroup.matrixWorld);
    }
    this.mouseShape.updateMatrixWorld(false);
    return out.set(0, 0.115, -0.05).applyMatrix4(this.mouseShape.matrixWorld);
  }

  public update(
    dt: number,
    leftDown: boolean,
    rightDown: boolean,
    deskHopY: number,
    privacyAlpha: number,
    mousing = true,
  ): void {
    if (deskHopY !== this.lastDeskHopY) {
      this.deskGroup.position.y = deskHopY;
      this.lastDeskHopY = deskHopY;
    }

    // Only animate keys that are actually pressed or rebounding/fading (0-3 keys instead of 67-108!)
    if (this.activeKeys.size > 0 && this.sideInstanced && this.topInstanced && this.topTintAttr && this.topTintArray) {
      let matrixDirty = false;
      let tintDirty = false;
      const baseY = this.boardH + 0.008;
      const kDownDepth = approach(62, dt);
      const kUpDepth = approach(24, dt);
      const kDownGlow = approach(44, dt);
      const kUpGlow = approach(6.5, dt);

      for (const k of this.activeKeys) {
        const targetDepth = k.down ? Math.min(0.032, this.capH * 0.7) : 0;
        k.depth += (targetDepth - k.depth) * (k.down ? kDownDepth : kUpDepth);
        k.glow += ((k.down ? 1 : 0) - k.glow) * (k.down ? kDownGlow : kUpGlow);

        const settled = !k.down && k.depth < 0.00025 && k.glow < 0.002;
        if (settled) {
          k.depth = 0;
          k.glow = 0;
          this.activeKeys.delete(k);
        }

        this.tmpPos.set(k.x, baseY - k.depth, k.z);
        this.tmpScale.set(k.scaleX, k.scaleY, k.scaleZ);
        this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        this.sideInstanced.setMatrixAt(k.index, this.tmpMat);
        this.topInstanced.setMatrixAt(k.index, this.tmpMat);
        matrixDirty = true;

        this.tmpCol.copy(this.whiteColor).lerp(this.hitColor, k.glow * 0.90);
        const off = k.index * 3;
        this.topTintArray[off] = this.tmpCol.r;
        this.topTintArray[off + 1] = this.tmpCol.g;
        this.topTintArray[off + 2] = this.tmpCol.b;
        tintDirty = true;
      }

      if (matrixDirty) {
        this.sideInstanced.instanceMatrix.needsUpdate = true;
        this.topInstanced.instanceMatrix.needsUpdate = true;
      }
      if (tintDirty) {
        this.topTintAttr.needsUpdate = true;
      }
    }

    if (this.privacyPlate) {
      this.privacyPlate.visible = privacyAlpha > 0.02;
      this.privacyMat.opacity = privacyAlpha;
    }

    this.mouseTarget.multiplyScalar(1 - approach(1.6, dt));
    this.mouseOffset.copy(this.mouseFollow.step(this.mouseTarget, dt));
    this.mouseGroup.position.copy(this.mouseHome);
    if (this.pad.enabled) {
      this.mouseGroup.position.copy(this.padHome);
      const mark = this.pad.clickMark();
      this.clickMarker.visible = !!mark && privacyAlpha < 0.02;
      if (mark && this.clickMarker.visible) {
        const p = padPosition(mark.point, false, this.padWidth * PAD_USABLE, this.padDepth * PAD_USABLE);
        this.clickMarker.position.set(p.x, 0.049, p.y);
        this.clickMarker.scale.setScalar(0.15 * mark.scale);
        this.clickMarker.material.opacity = mark.opacity;
      }
      this.padGroup.position.y = leftDown || rightDown || this.pad.pressed ? -0.012 : 0;
    } else {
      this.mouseGroup.position.add(this.mouseOffset);
    }

    this.leftPress += ((leftDown ? 1 : 0) - this.leftPress) * approach(32, dt);
    this.rightPress += ((rightDown ? 1 : 0) - this.rightPress) * approach(32, dt);
    if (this.leftPress < 0.002 && !leftDown) this.leftPress = 0;
    if (this.rightPress < 0.002 && !rightDown) this.rightPress = 0;
    this.wheelGlow = Math.max(0, this.wheelGlow - dt * 3.8);

    // Hide transparent L/R click highlight patches completely when not pressed (saves 2 alpha draw calls!)
    const leftBtn = this.mouseShape.userData.leftBtn as THREE.Mesh | undefined;
    const rightBtn = this.mouseShape.userData.rightBtn as THREE.Mesh | undefined;
    this.leftBtnMat.opacity = 0.88 * this.leftPress;
    this.rightBtnMat.opacity = 0.88 * this.rightPress;
    if (leftBtn) leftBtn.visible = this.leftPress > 0.005;
    if (rightBtn) rightBtn.visible = this.rightPress > 0.005;

    this.wheelMat.color.set('#555966').lerp(this.hitColor, this.wheelGlow);

    const anyPress = Math.max(this.leftPress, this.rightPress);
    this.mouseShape.scale.set(1 + 0.03 * anyPress, 1 - 0.10 * anyPress, 1);

    if (this.tabletActive) {
      this.tabletClock += dt;
      const idleGoal = mousing ? 0 : 1;
      this.tabletIdleBlend += (idleGoal - this.tabletIdleBlend) * approach(mousing ? 16 : 6.5, dt);
      const idle = this.tabletIdleBlend;

      if (!mousing) {
        this.tabletPenTarget.x += (this.tabletPadCenterX - this.tabletPenTarget.x) * approach(1.4, dt);
        this.tabletPenTarget.z += (0.02 - this.tabletPenTarget.z) * approach(1.4, dt);
      }
      this.tabletPenPos.copy(this.tabletPenFollow.step(this.tabletPenTarget, dt));

      const hoverY = this.tabletThickness + mix(0.024, 0.005, this.leftPress);
      const restY = this.tabletThickness + 0.022;
      this.stylusGroup.position.set(
        this.tabletPenPos.x,
        mix(hoverY, restY, idle),
        this.tabletPenPos.z,
      );
      const dynLeanX = clamp(this.tabletPenFollow.v.z * 0.08, -0.14, 0.14) * (1 - idle);
      const dynLeanZ = clamp(-this.tabletPenFollow.v.x * 0.08, -0.16, 0.16) * (1 - idle);
      this.stylusGroup.rotation.set(
        mix(0.22 + this.leftPress * 0.07 + dynLeanX, 0.12, idle),
        mix(0, 0.48, idle),
        mix(-0.34 - this.leftPress * 0.08 + dynLeanZ, -1.32, idle),
      );

      this.tabletLedMat.color
        .set('#4a5264')
        .lerp(this.hitColor, Math.max(this.leftPress, this.rightPress * 0.6));

      // Record live fading glowing strokes on the drawing pad while pen nib touches down!
      const isDrawing = leftDown && mousing && privacyAlpha < 0.2;
      if (isDrawing) {
        const padW = this.tabletPadW - 0.016;
        const padD = this.tabletPadD - 0.016;
        const u = clamp((this.tabletPenPos.x - this.tabletPadCenterX) / padW + 0.5, 0.04, 0.96);
        const v = clamp(this.tabletPenPos.z / padD + 0.5, 0.04, 0.96);
        const prev = this.tabletStrokes.length > 0 ? this.tabletStrokes[this.tabletStrokes.length - 1] : null;
        const moved = !prev || !this.tabletWasDrawing || Math.hypot(u - prev.u, v - prev.v) >= 0.012;
        if (moved) {
          this.tabletStrokes.push({ u, v, t: this.tabletClock, breakLine: !this.tabletWasDrawing });
          if (this.tabletStrokes.length > 72) {
            this.tabletStrokes.shift();
          }
          this.tabletPadDirty = true;
        }
      }
      this.tabletWasDrawing = isDrawing;

      if (this.tabletStrokes.length > 0) {
        let expired = 0;
        while (expired < this.tabletStrokes.length && this.tabletClock - this.tabletStrokes[expired].t > 1.38) {
          expired += 1;
        }
        if (expired > 0) {
          this.tabletStrokes.splice(0, expired);
        }
        this.tabletPadDirty = true;
      }
      if (this.tabletPadDirty) {
        this.redrawTabletPadCanvas();
      }
    }

    if (this.gamepadActive) {
      this.gpClock += dt;
      const stickStep = approach(32, dt);
      this.gpSmLx += (this.gpTarget.lx - this.gpSmLx) * stickStep;
      this.gpSmLy += (this.gpTarget.ly - this.gpSmLy) * stickStep;
      this.gpSmRx += (this.gpTarget.rx - this.gpSmRx) * stickStep;
      this.gpSmRy += (this.gpTarget.ry - this.gpSmRy) * stickStep;
      this.gpSmLt += (this.gpTarget.lt - this.gpSmLt) * stickStep;
      this.gpSmRt += (this.gpTarget.rt - this.gpSmRt) * stickStep;

      const btnDownStep = approach(48, dt);
      const btnUpStep = approach(20, dt);
      let anyBtnEnergy = 0;
      for (let i = 0; i < 12; i++) {
        const down = (this.gpTarget.buttons & (1 << i)) !== 0 ? 1 : 0;
        const cur = this.gpBtnAnim[i];
        const next = cur + (down - cur) * (down ? btnDownStep : btnUpStep);
        this.gpBtnAnim[i] = !down && next < 0.002 ? 0 : next;
        if (this.gpBtnAnim[i] > anyBtnEnergy) anyBtnEnergy = this.gpBtnAnim[i];
      }

      // Left & right analog thumbsticks pivot smoothly in their recessed wells
      this.gpLeftStick.rotation.set(-this.gpSmLy * 0.48, 0, -this.gpSmLx * 0.48);
      this.gpRightStick.rotation.set(-this.gpSmRy * 0.48, 0, -this.gpSmRx * 0.48);
      const lMag = clamp(Math.hypot(this.gpSmLx, this.gpSmLy), 0, 1);
      const rMag = clamp(Math.hypot(this.gpSmRx, this.gpSmRy), 0, 1);
      this.gpLeftStickCapMat.color.copy(this.gpStickRimIdle).lerp(this.hitColor, lMag * 0.85);
      this.gpRightStickCapMat.color.copy(this.gpStickRimIdle).lerp(this.hitColor, rMag * 0.85);

      // 4-Way Cross D-Pad arms sink and glow neon accent on press
      const syncDpad = (
        part: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; baseY: number },
        amt: number,
      ) => {
        part.mesh.position.y = part.baseY - amt * 0.015;
        part.mat.color.copy(this.gpBaseDark).lerp(this.hitColor, amt * 0.92);
      };
      syncDpad(this.gpDpadMeshes.up, this.gpBtnAnim[6]);
      syncDpad(this.gpDpadMeshes.down, this.gpBtnAnim[7]);
      syncDpad(this.gpDpadMeshes.left, this.gpBtnAnim[8]);
      syncDpad(this.gpDpadMeshes.right, this.gpBtnAnim[9]);

      // Diamond ABXY buttons depress & flash bright highlight
      for (let i = 0; i < this.gpFaceBtns.length; i++) {
        const fb = this.gpFaceBtns[i];
        const amt = this.gpBtnAnim[i];
        fb.group.position.y = fb.baseY - amt * 0.022;
        fb.sideMat.color.copy(fb.baseColor).lerp(this.whiteColor, amt * 0.55);
        fb.topMat.color.copy(this.whiteColor).lerp(this.hitColor, amt * 0.35);
      }

      // BACK / START mini pills
      this.gpBackBtn.mesh.position.y = this.gpBackBtn.baseY - this.gpBtnAnim[11] * 0.010;
      this.gpBackBtn.mat.color.copy(this.gpBaseDark).lerp(this.hitColor, this.gpBtnAnim[11] * 0.9);
      this.gpStartBtn.mesh.position.y = this.gpStartBtn.baseY - this.gpBtnAnim[10] * 0.010;
      this.gpStartBtn.mat.color.copy(this.gpBaseDark).lerp(this.hitColor, this.gpBtnAnim[10] * 0.9);

      // Authentic Xbox Stacked Shoulders: Upper Curved Bumper (Cyan) + Lower Hinged Curved Trigger (Orange) + Press-Time Callout Pills
      const GP_TOP = 0.145;
      const syncShoulderPair = (pair: typeof this.gpShoulderL, bAmt: number, tAmt: number) => {
        pair.bumperGroup.position.set(0, GP_TOP + 0.002 - bAmt * 0.012, -0.018 + bAmt * 0.028);
        pair.bumperMat.color.copy(this.gpBumperDark).lerp(this.gpBumperActive, bAmt * 0.96);
        pair.bumperAccentMat.color.set(bAmt > 0.10 ? '#e0f2fe' : '#58657f');

        pair.triggerPivot.position.set(0, GP_TOP - 0.050 - tAmt * 0.008, -0.315 + tAmt * 0.032);
        pair.triggerPivot.rotation.x = tAmt * 0.42;
        pair.triggerMat.color.copy(this.gpTriggerDark).lerp(this.gpTriggerActive, tAmt * 0.98);

        const both = bAmt > 0.08 && tAmt > 0.08;
        const bShow = bAmt > 0.06;
        pair.bBadgeGroup.visible = bShow;
        if (bShow) {
          const pop = smoothstep(0.06, 0.28, bAmt);
          pair.bBadgeMat.opacity = pop;
          pair.bBadgeGroup.scale.setScalar(0.84 + 0.20 * pop);
          pair.bBadgeGroup.position.set(
            pair.side * 0.335,
            GP_TOP + (both ? 0.105 : 0.052) + pop * 0.022,
            -0.455,
          );
        }

        const tShow = tAmt > 0.06;
        pair.tBadgeGroup.visible = tShow;
        if (tShow) {
          const pop = smoothstep(0.06, 0.28, tAmt);
          pair.tBadgeMat.opacity = pop;
          pair.tBadgeGroup.scale.setScalar(0.84 + 0.20 * pop);
          pair.tBadgeGroup.position.set(
            pair.side * 0.335,
            GP_TOP + (both ? -0.036 : 0.015) - pop * 0.014,
            -0.495,
          );
          const fill = clamp(tAmt, 0.08, 1);
          const fullW = 0.192;
          pair.tGaugeFill.scale.set(fill, 1, 1);
          // Inside gamepadRig (rotY=PI), local +X is screen-LEFT, so anchor fill on +fullW/2 to grow left->right
          pair.tGaugeFill.position.x = (fullW * (1 - fill)) * 0.5;
        }
      };
      syncShoulderPair(this.gpShoulderL, this.gpBtnAnim[4], this.gpSmLt);
      syncShoulderPair(this.gpShoulderR, this.gpBtnAnim[5], this.gpSmRt);

      // Home LED gentle breathing + reactive burst on button mash
      const ledPulse = 0.72 + 0.16 * Math.sin(this.gpClock * 3.4) + anyBtnEnergy * 0.28;
      this.gpHomeLedMat.color
        .copy(this.hitColor)
        .multiplyScalar(clamp(ledPulse, 0.55, 1.0));

      // Grounded flat-on-desk tactile bounce (sturdy on desk, subtle press squash when mashing combos!)
      this.gpBounce = Math.max(0, this.gpBounce - dt * 5.2);
      this.gpTapL = Math.max(0, this.gpTapL - dt * 8.5);
      this.gpTapR = Math.max(0, this.gpTapR - dt * 8.5);
      const squash = this.gpBounce * 0.055;
      this.gamepadBody.position.set(0, 0.015 - squash * 0.14, 0.0);
      this.gamepadBody.scale.set(1.30 * (1 + squash * 0.25), 1.30 * (1 - squash), 1.30 * (1 + squash * 0.20));
      this.gamepadBody.rotation.set(0.14, 0, 0);
    }
  }

  public dispose(): void {
    this.clickMarker.material.map?.dispose();
    this.deskGroup.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else if (mat) {
        mat.dispose();
      }
    });
    for (const d of this.boardDisposables) {
      d.dispose();
    }
    this.boardDisposables.length = 0;
    this.capSideGeo.dispose();
    this.capTopBaseGeo.dispose();
    this.capSideMat.dispose();
    this.chassisMat.dispose();
    this.tabletPadTex.dispose();
    this.kbShadowMat.dispose();
    disposeKeyboardCaches();
  }
}
