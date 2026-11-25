import { BirdVisit, type BirdVariation, type BirdVisitFrame, type BirdVisitKind } from './birdVisit';

const TYPING_EXHALE_OFFSET_MS = 1400;
const SLEEP_VISIT_CHANCE = 0.65;
const SLEEP_DELAY_MS = 3000;
const SLEEP_DELAY_VARIATION_MS = 5000;

export class BirdVisitPlayer {
  private visit: BirdVisit | null = null;
  private startedAt = 0;
  private sleepAt: number | null = null;
  private currentFrame: BirdVisitFrame | null = null;
  private lastVariation: BirdVariation | undefined;

  public get active(): boolean {
    return this.visit !== null;
  }

  public get frame(): BirdVisitFrame | null {
    return this.currentFrame;
  }

  public get variation(): BirdVariation | undefined {
    return this.visit?.variation;
  }

  public start(now: number, kind: BirdVisitKind): void {
    this.visit = new BirdVisit(this.lastVariation, undefined, kind);
    this.startedAt = kind === 'typing' ? now - TYPING_EXHALE_OFFSET_MS : now;
    this.currentFrame = null;
  }

  public scheduleSleepPreview(now: number): void {
    this.clearVisit();
    this.sleepAt = now;
  }

  public update(now: number, asleep: boolean, sleepAmount: number, enabled: boolean): void {
    if (!asleep) this.sleepAt = null;
    if (!enabled) {
      this.clearVisit();
      return;
    }

    if (asleep && sleepAmount >= 0.8) {
      // Infinity records the sleep episode's completed decision or visit.
      if (this.sleepAt === null) {
        this.sleepAt = Math.random() < SLEEP_VISIT_CHANCE
          ? now + SLEEP_DELAY_MS + Math.random() * SLEEP_DELAY_VARIATION_MS
          : Infinity;
      }
      if (!this.visit && now >= this.sleepAt) {
        this.sleepAt = Infinity;
        this.start(now, 'sleep');
      }
    }

    if (!this.visit) return;
    const seconds = (now - this.startedAt) / 1000;
    if (seconds >= this.visit.departure.end) {
      this.clearVisit();
      return;
    }
    this.currentFrame = this.visit.sample(seconds);
    if (this.currentFrame.pose) this.lastVariation = this.visit.variation;
  }

  public onKeyDown(now: number): void {
    if (!this.visit) return;
    const seconds = (now - this.startedAt) / 1000;
    if (this.visit.sample(seconds).pose) this.visit.onKeyDown(seconds);
    else this.clearVisit();
  }

  public clearVisit(): void {
    this.visit = null;
    this.currentFrame = null;
  }
}
