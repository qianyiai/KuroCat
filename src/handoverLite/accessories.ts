import layout from './art/accessories/layout.json';

export interface AccessoryHead {
  x: number;
  y: number;
  width: number;
  /** Positive angles turn towards the left edge of the screen. */
  yaw: number;
}

const collarColors = { red: '#d9483b', blue: '#3d7cc9', pink: '#e57b98', green: '#4fa368' };
export interface CastAccessorySettings {
  headphones: boolean;
  collar: 'none' | keyof typeof collarColors;
}

/** The depth-tested photos use the same 1024 × 768 camera as the seated poses. */
export async function prepareAccessories(load: (name: string) => Promise<HTMLImageElement>) {
  const atlas = await load('accessories/gear.webp');
  const { angles, cols, parts } = layout;
  // The neck only turns from -12 to +12 degrees. Its two layers share
  // the five reachable poses in a compact strip, including both cheeks.
  const collarFirst = angles.indexOf(-12);
  const collarRows = Math.ceil((angles.indexOf(12) - collarFirst + 1) / cols);
  const bands = new Map<keyof typeof collarColors, HTMLCanvasElement>();

  function tintedBand(color: keyof typeof collarColors) {
    let band = bands.get(color);
    if (!band) {
      const p = parts.band;
      band = document.createElement('canvas');
      band.width = cols * p.sw;
      band.height = collarRows * p.sh;
      const g = band.getContext('2d')!;
      g.drawImage(atlas, 0, p.top, band.width, band.height, 0, 0, band.width, band.height);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = collarColors[color];
      g.fillRect(0, 0, band.width, band.height);
      bands.set(color, band);
    }
    return band;
  }

  return (ctx: CanvasRenderingContext2D, head: AccessoryHead, settings: CastAccessorySettings, behind = false) => {
    function view(yaw: number) {
      return angles.indexOf(angles.reduce((nearest, candidate) =>
        Math.abs(candidate - yaw) < Math.abs(nearest - yaw) ? candidate : nearest));
    }
    const i = view(head.yaw);
    const scale = head.width / 281.47;
    function paint(part: keyof typeof parts, source: CanvasImageSource, top: number,
      offsetX = 0, offsetY = 0, horizontal = 1, vertical = 1, frame = i) {
      const p = parts[part];
      ctx.drawImage(source, (frame % cols) * p.sw, top + Math.floor(frame / cols) * p.sh, p.sw, p.sh,
        head.x + ((p.x - 504.54) * horizontal + offsetX) * scale, head.y + (p.y - 190.37 + offsetY) * scale,
        p.w * horizontal * scale, p.h * vertical * scale);
    }
    if (behind) {
      if (settings.headphones) paint('back', atlas, parts.back.top);
      return;
    }
    if (settings.collar !== 'none') {
      // The standing cels extend the head beyond the chest. Bring the band
      // around the neck and keep the round bell on the same attachment point.
      const signedTurn = Math.max(-1, Math.min(1, head.yaw / 45));
      const turn = Math.abs(signedTurn);
      const bandView = view(12 * signedTurn);
      const stripFrame = bandView - collarFirst;
      const width = 1 - .32 * turn;
      const inset = 40 * signedTurn;
      const height = 1 - .30 * turn;
      const lower = 43 * turn;
      const bandY = lower + (parts.band.y - 295) * (height - 1);
      const bellY = lower + (308 - 295) * (height - 1);
      const bellLateral = -120 * Math.sin(angles[bandView] * Math.PI / 180);
      paint('band', tintedBand(settings.collar), 0, inset, bandY, width, height, stripFrame);
      paint('bell', atlas, parts.bell.top, inset + bellLateral * (width - 1), bellY, 1, 1, stripFrame);
    }
    if (settings.headphones) paint('headset', atlas, parts.headset.top);
  };
}
