import type { KeySpec } from './keyboardLayout';

// Monochrome vector artwork in a 24 × 24 view box. The same paths paint the atlas and Canvas 2D.
const sun = 'M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z';
const speaker = 'M3 9h4l5-4v14l-5-4H3Z';
const icons: Record<string, string> = {
  f1: sun,
  f2: sun,
  f3: 'M2 4h12v8H2ZM16 5h6v6h-6ZM8 14h13v7H8Z',
  f4: 'M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0Zm-1 5 6 6',
  f5: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0ZM6 11v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8',
  f6: 'M20 16A9 9 0 0 1 8 4a9 9 0 1 0 12 12Z',
  f7: 'M11 6 3 12l8 6Zm10 0-8 6 8 6Z',
  f8: 'M4 5v14l9-7ZM16 5v14m4-14v14',
  f9: 'M3 6v12l8-6Zm10 0v12l8-6Z',
  f10: speaker + 'M16 9l6 6m0-6-6 6',
  f11: speaker + 'M16 9q3 3 0 6',
  f12: speaker + 'M15 9q3 3 0 6m3-9q6 6 0 12',
  fn: 'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0ZM2 12h20M12 2q-10 10 0 20 10-10 0-20Z',
};
const paths = new Map<string, Path2D>();
const symbols: Record<string, string> = { control: '⌃', option: '⌥', command: '⌘' };
const shifted: Record<string, string> = {
  grave: '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  minus: '_',
  equal: '+',
  lb: '{',
  rb: '}',
  bslash: '|',
  semi: ':',
  quote: '"',
  comma: '<',
  dot: '>',
  slash: '?',
};

export function paintMacBookLegend(
  ctx: CanvasRenderingContext2D,
  key: KeySpec,
  width: number,
  height: number,
  rotated: boolean,
  ink = '#f1f1f3',
): void {
  ctx.save();
  if (rotated) ctx.rotate(Math.PI);
  ctx.strokeStyle = ctx.fillStyle = ink;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const unit = Math.min(width / key.uWidth, height / (key.rowSpan ?? 1));
  const text = (value: string, size: number, y: number) => {
    ctx.font = `500 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(value, 0, y, width * 0.89);
  };
  if (key.id === 'touchid') {
    ctx.lineWidth = unit * 0.055;
    ctx.strokeStyle = '#696a70';
    ctx.beginPath();
    ctx.arc(0, 0, unit * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  } else if (icons[key.id]) {
    const size = unit * (key.id === 'f1' ? 0.37 : 0.48);
    let path = paths.get(key.id);
    if (!path) {
      path = new Path2D(icons[key.id]);
      paths.set(key.id, path);
    }
    ctx.save();
    ctx.translate(-size / 2, -height * 0.16 - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.lineWidth = 1.9;
    ctx.stroke(path);
    ctx.restore();
    text(key.label, unit * 0.24, height * 0.29);
  } else if (symbols[key.label] || shifted[key.id]) {
    text(symbols[key.label] || shifted[key.id], unit * 0.39, -height * 0.19);
    text(key.label, unit * (key.label.length > 1 ? 0.23 : 0.34), height * 0.26);
  } else if (key.label) {
    const size = key.rowSpan === 0.5 ? height * 0.78 : unit * (key.label.length > 1 ? 0.32 : 0.54);
    text(key.label, size, 0);
  }
  ctx.restore();
}
