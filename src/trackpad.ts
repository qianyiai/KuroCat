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
const NATIVE_CONTACT_GRACE_MS = 450;
const HOLD_LAST_TOUCH_MS = 900;
const POINTER_FALLBACK_TTL_MS = 4000;
const WHEEL_GLIDE_TTL_MS = 1400;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function contactCentroid(points: readonly PadPoint[]): PadPoint | undefined {
  if (points.length === 0) return undefined;
  if (points.length === 1) return points[0];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < points.length; i++) {
    sx += points[i].x;
    sy += points[i].y;
  }
  return {
    id: points[0].id,
    x: sx / points.length,
    y: sy / points.length,
  };
}

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
  private lastNativePoint?: PadPoint;
  private lastNativeAt = -Infinity;
  private fallbackPoint?: PadPoint;
  private fallbackAt = -Infinity;
  private wheelOffsetY = 0;
  private lastWheelAt = -Infinity;

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.points = [];
    this.clickedAt = -Infinity;
    this.clickPoint = undefined;
    this.lastNativePoint = undefined;
    this.lastNativeAt = -Infinity;
    this.fallbackPoint = undefined;
    this.fallbackAt = -Infinity;
    this.wheelOffsetY = 0;
    this.lastWheelAt = -Infinity;
  }

  setContacts(points: readonly PadPoint[], now = performance.now()): void {
    this.points = points;
    const centroid = contactCentroid(points);
    if (centroid) {
      this.lastNativePoint = centroid;
      this.lastNativeAt = now;
      this.wheelOffsetY = 0;
    }
  }

  onPointerMove(nx: number, ny: number, now = performance.now()): void {
    if (!this.enabled) return;
    this.fallbackPoint = {
      id: -1,
      x: clamp(nx, 0.06, 0.94),
      y: clamp(ny, 0.06, 0.94),
    };
    this.fallbackAt = now;
    this.wheelOffsetY = 0;
  }

  onScroll(delta: number, now = performance.now()): void {
    if (!this.enabled || !Number.isFinite(delta) || delta === 0) return;
    if (this.points.length > 0 || now - this.lastNativeAt < NATIVE_CONTACT_GRACE_MS) {
      return;
    }
    const prevElapsed = Math.max(0, now - this.lastWheelAt);
    const decayed = prevElapsed < WHEEL_GLIDE_TTL_MS ? this.wheelOffsetY * Math.exp(-prevElapsed / 260) : 0;
    const step = Math.tanh(delta / 24) * 0.14;
    this.wheelOffsetY = clamp(decayed + step, -0.36, 0.36);
    this.lastWheelAt = now;
    if (!this.fallbackPoint) {
      this.fallbackPoint = { id: -1, x: 0.5, y: 0.5 };
    }
  }

  press(point?: PadPoint, now = performance.now()): void {
    this.clickPoint = point ?? contactCentroid(this.points) ?? this.getTarget(now);
    this.clickedAt = now;
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

  getTarget(now = performance.now()): PadPoint | undefined {
    // 1) Live multitouch contacts (1 finger, 2-finger scroll/thumb-rest, 3-finger swipe, click-and-drag)
    const live = contactCentroid(this.points);
    if (live) return live;

    // 2) Active click / tap-to-click right after finger lift (only when no newer drag occurred)
    if (now - this.clickedAt < PRESS_MS && this.clickPoint && this.clickedAt >= this.lastNativeAt) {
      return this.clickPoint;
    }

    // 3) Brief hold at native lift-off spot so paw doesn't snap awkwardly to dead center
    const nativeAge = now - this.lastNativeAt;
    if (this.lastNativePoint && nativeAge < NATIVE_CONTACT_GRACE_MS) {
      return this.lastNativePoint;
    }

    // 4) Pointer & scroll fallback when raw MultitouchSupport contacts aren't arriving
    // (external/non-Apple trackpad, TCC/Input Monitoring block, post-sleep, or scroll momentum)
    const wheelAge = now - this.lastWheelAt;
    const hasRecentWheel = wheelAge < WHEEL_GLIDE_TTL_MS;
    const hasRecentPointer = now - this.fallbackAt < POINTER_FALLBACK_TTL_MS;
    if (this.fallbackPoint && (hasRecentPointer || hasRecentWheel)) {
      const wy = hasRecentWheel ? this.wheelOffsetY * Math.exp(-Math.max(0, wheelAge) / 260) : 0;
      return {
        id: -1,
        x: clamp(this.fallbackPoint.x, 0.06, 0.94),
        y: clamp(this.fallbackPoint.y + wy, 0.08, 0.92),
      };
    }

    if (this.lastNativePoint && nativeAge < HOLD_LAST_TOUCH_MS) {
      return this.lastNativePoint;
    }
    return undefined;
  }

  get target(): PadPoint | undefined {
    return this.getTarget();
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
