export interface PadPoint {
  id: number;
  x: number;
  y: number;
}

// USB-C Magic Trackpad footprint: 160 × 114.9 mm. The inset keeps edge contacts on the glass.
export const PAD_DEPTH_RATIO = 114.9 / 160;

// Negative desk depth points toward the cat, regardless of which way the key legends face.
export function padCenterDepth(keyboardDepth: number, padDepth: number): number {
  return (padDepth - keyboardDepth) / 2;
}

export const PAD_USABLE = 0.90;
const PRESS_MS = 220;
const MARK_MS = 800;

export function drawClickMark(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.77, 0, Math.PI * 2);
  ctx.lineWidth = radius * 0.39;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.lineWidth = radius * 0.22;
  ctx.strokeStyle = '#1555bd';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = '#103878';
  ctx.fill();
  ctx.lineWidth = radius * 0.12;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

export class Trackpad {
  enabled = false;
  points: readonly PadPoint[] = [];
  private clickPoint?: PadPoint;
  private clickedAt = -Infinity;

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.points = [];
    this.clickedAt = -Infinity;
    this.clickPoint = undefined;
  }

  press(point?: PadPoint): void {
    this.clickPoint = point;
    this.clickedAt = performance.now();
  }

  get pressed(): boolean {
    return performance.now() - this.clickedAt < PRESS_MS;
  }

  clickMark(now = performance.now()) {
    const progress = (now - this.clickedAt) / MARK_MS;
    if (!this.enabled || !this.clickPoint || progress < 0 || progress >= 1) return;
    return {
      point: this.clickPoint,
      scale: 1 + 0.32 * progress,
      opacity: Math.min(1, (1 - progress) * 3),
    };
  }

  get target(): PadPoint | undefined {
    return this.pressed ? this.clickPoint : this.points.length === 1 ? this.points[0] : undefined;
  }
}

// Input is normalized from the user's top left. Both views rotate the same physical surface.
export function padPosition(point: PadPoint | undefined, catFacing: boolean, width: number, depth: number) {
  const direction = catFacing ? -1 : 1;
  return {
    x: ((point?.x ?? 0.5) - 0.5) * width * direction,
    y: ((point?.y ?? 0.5) - 0.5) * depth * direction,
  };
}
