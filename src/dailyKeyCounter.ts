export interface DailyKeyCount {
  date: string;
  count: number;
  revision: number;
}

interface CounterArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export type CounterBounds = [left: number, top: number, right: number, bottom: number];

const ROLL_MS = 120;
const FLOAT_MS = 560;
const MAX_FLOATS = 5;
const countFormatter = new Intl.NumberFormat('en-US');

export class DailyKeyCounter {
  private snapshot: DailyKeyCount | null = null;
  private from = 0;
  private rollAt = 0;
  private floats: { at: number; lane: number }[] = [];

  public get visible(): boolean {
    return (this.snapshot?.count ?? 0) > 0;
  }

  public accept(next: DailyKeyCount, animate: boolean, now = performance.now()): boolean {
    const before = this.snapshot;
    if (
      !next || typeof next.date !== 'string' ||
      !Number.isSafeInteger(next.count) || next.count < 0 ||
      !Number.isSafeInteger(next.revision) || next.revision < 0 ||
      (before && next.revision <= before.revision)
    ) return false;

    const sameDate = before?.date === next.date;
    const previousCount = sameDate ? before.count : 0;
    const delta = next.count - previousCount;
    const shouldRoll = animate && delta > 0 && (sameDate || next.count === 1);
    const from = sameDate ? this.valueAt(now) : 0;
    this.snapshot = next;
    if (sameDate && delta === 0) return false;

    this.from = shouldRoll ? from : next.count;
    this.rollAt = now;
    if (!sameDate || !shouldRoll) this.floats = [];
    if (shouldRoll) {
      this.floats = this.floats.filter((entry) => now - entry.at < FLOAT_MS);
      for (let i = Math.max(1, delta - MAX_FLOATS + 1); i <= delta; i++) {
        this.floats.push({ at: now, lane: (previousCount + i) % 3 });
      }
      this.floats = this.floats.slice(-MAX_FLOATS);
    }
    return true;
  }

  private valueAt(now: number): number {
    const count = this.snapshot?.count ?? 0;
    const progress = Math.max(0, Math.min(1, (now - this.rollAt) / ROLL_MS));
    return progress === 1 ? count : count - (count - this.from) * (1 - progress) ** 2;
  }

  public draw(ctx: CanvasRenderingContext2D, area: CounterArea, now = performance.now()): CounterBounds | undefined {
    const count = this.snapshot?.count ?? 0;
    if (count === 0) return;
    const digitCount = String(count).length;
    const columns = countFormatter.format(count);
    const fontSize = Math.max(8, Math.min(24, 16 * area.scale));
    const rowHeight = fontSize * 1.28;
    const padX = 6;
    const padY = 1;
    const value = this.valueAt(now);
    const whole = Math.floor(value);
    const shift = (value - whole) * rowHeight;

    ctx.save();
    ctx.font = `600 ${fontSize}px "Cascadia Mono", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const digitWidth = ctx.measureText('0').width;
    const halfWidth = digitWidth * columns.length * 0.5;
    const minX = Math.min(area.width * 0.5, halfWidth + padX + 3);
    const x = Math.max(minX, Math.min(area.width - minX, area.x));
    const minY = Math.min(area.height * 0.5, rowHeight * 0.5 + padY + 3);
    const y = Math.max(minY, Math.min(area.height - minY, area.y));
    const left = x - halfWidth;
    const plateLeft = left - padX;
    const plateRight = x + halfWidth + padX;
    const plateTop = y - rowHeight * 0.5 - padY;
    const plateBottom = y + rowHeight * 0.5 + padY;
    let boundsLeft = plateLeft - 5;
    let boundsTop = plateTop - 4;
    let boundsRight = plateRight + 5;
    let boundsBottom = plateBottom + 6;

    ctx.save();
    ctx.fillStyle = 'rgba(19, 22, 29, 0.90)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.moveTo(plateLeft + 5, plateTop);
    ctx.arcTo(plateRight, plateTop, plateRight, plateBottom, 5);
    ctx.arcTo(plateRight, plateBottom, plateLeft, plateBottom, 5);
    ctx.arcTo(plateLeft, plateBottom, plateLeft, plateTop, 5);
    ctx.arcTo(plateLeft, plateTop, plateRight, plateTop, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#f4f5fa';
    ctx.beginPath();
    ctx.rect(left - 3, y - rowHeight * 0.5, 2 * halfWidth + 6, rowHeight);
    ctx.clip();
    let place = 10 ** (digitCount - 1);
    for (let i = 0; i < columns.length; i++) {
      const digitX = left + (i + 0.5) * digitWidth;
      if (columns[i] === ',') {
        if (whole + (shift > 0 ? 1 : 0) >= place * 10) ctx.fillText(',', digitX, y);
        continue;
      }
      const oldDigit = whole >= place ? String(Math.floor(whole / place) % 10) : '';
      const newDigit = whole + 1 >= place ? String(Math.floor((whole + 1) / place) % 10) : '';
      place /= 10;
      if (shift > 0 && oldDigit !== newDigit) {
        if (oldDigit) ctx.fillText(oldDigit, digitX, y - shift);
        if (newDigit) ctx.fillText(newDigit, digitX, y + rowHeight - shift);
      } else if (oldDigit) {
        ctx.fillText(oldDigit, digitX, y);
      }
    }
    ctx.restore();

    this.floats = this.floats.filter((entry) => now - entry.at < FLOAT_MS);
    ctx.font = `600 ${fontSize * 0.78}px "Cascadia Mono", Consolas, monospace`;
    ctx.fillStyle = '#dceba9';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.82)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    const floatOffset = halfWidth + padX + fontSize * 0.85 + 3;
    const direction = x + floatOffset + fontSize <= area.width ? 1 : -1;
    for (const entry of this.floats) {
      const age = Math.max(0, (now - entry.at) / FLOAT_MS);
      const floatX = Math.max(fontSize * 0.5, Math.min(area.width - fontSize * 0.5,
        x + direction * (floatOffset + (entry.lane - 1) * 4)));
      const floatY = Math.max(fontSize * 0.5, y + 2 - 1.15 * fontSize * age);
      ctx.globalAlpha = (1 - age) ** 1.3;
      ctx.fillText('+1', floatX, floatY);
      boundsLeft = Math.min(boundsLeft, floatX - fontSize);
      boundsTop = Math.min(boundsTop, floatY - fontSize * 0.6);
      boundsRight = Math.max(boundsRight, floatX + fontSize);
      boundsBottom = Math.max(boundsBottom, floatY + fontSize * 0.6 + 2);
    }
    ctx.restore();
    return [
      Math.max(0, boundsLeft / area.width),
      Math.max(0, boundsTop / area.height),
      Math.min(1, boundsRight / area.width),
      Math.min(1, boundsBottom / area.height),
    ];
  }
}
