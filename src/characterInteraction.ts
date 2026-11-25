import type { Motion2d, Reaction } from './characterMotion2d.ts';
import type { CharacterReactionState } from './characterSync.ts';

/** Input-independent, deterministic gesture and personality state; times are milliseconds. */
export class CharacterInteraction {
  energy = 0;
  private previous: [number, number] | null = null;
  private direction: [number, number] | null = null;
  private travel = 0;
  private reverse = 0;
  private strokes = 0;
  private over = false;
  private privacy = false;
  private lastEnergyAt: number | null = null;
  private active: { reaction: Reaction; started: number; event: string } | null = null;
  private cooldowns = new Map<Reaction, number>();
  readonly motion: Motion2d;
  private random: () => number;
  constructor(motion: Motion2d, random: () => number = Math.random) { this.motion = motion; this.random = random; }

  reset(privacy = this.privacy): void {
    this.energy = 0; this.previous = null; this.direction = null;
    this.travel = this.reverse = this.strokes = 0;
    this.active = null; this.cooldowns.clear(); this.privacy = privacy;
    this.lastEnergyAt = null; this.over = false;
  }

  tick(now: number): void {
    const dt = this.lastEnergyAt === null ? 0 : Math.max(0, now - this.lastEnergyAt) / 1000;
    this.lastEnergyAt = now;
    this.energy = Math.max(0, this.energy - dt * (this.over ? this.motion.petting.decayInside : this.motion.petting.decayOutside));
    if (this.active && now - this.active.started >= this.active.reaction.durationMs) this.active = null;
  }

  cursor(x: number, y: number, allowed: boolean, released: boolean, full: boolean, now: number): void {
    this.tick(now);
    const layout = full ? this.motion.layouts.full : this.motion.layouts.compact;
    const [cx, cy] = layout.petEllipseCenter;
    const [rx, ry] = layout.petEllipseRadius;
    this.over = allowed && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    if (!this.over || !released || this.privacy) {
      this.previous = null; this.direction = null; this.travel = this.reverse = this.strokes = 0;
      return;
    }
    const point: [number, number] = [x * layout.logicalSize[0], y * layout.logicalSize[1]];
    if (this.previous) {
      const dx = point[0] - this.previous[0], dy = point[1] - this.previous[1];
      const distance = Math.hypot(dx, dy), p = this.motion.petting;
      if (distance > p.stepDistancePx[0] && distance < p.stepDistancePx[1]) {
        if (!this.direction) {
          this.travel += distance;
          if (this.travel >= p.strokeDistancePx) this.direction = [dx / distance, dy / distance];
        } else if (dx / distance * this.direction[0] + dy / distance * this.direction[1] >= p.directionDot) {
          this.travel += distance; this.reverse = Math.max(0, this.reverse - distance * .5);
        } else {
          this.reverse += distance;
          if (this.travel >= p.strokeDistancePx && this.reverse >= p.strokeDistancePx) {
            this.strokes++; this.direction = [dx / distance, dy / distance];
            this.travel = this.reverse; this.reverse = 0;
          }
        }
        if (this.strokes >= p.requiredReversals) {
          this.energy = Math.min(1, this.energy + distance * p.energyPerPixel);
          if (this.energy > p.happyThreshold) this.react('pet', now);
        }
      }
    }
    this.previous = point;
  }

  react(event: 'pet' | 'typing' | 'idle', now: number): void {
    if (this.privacy) return;
    if (event === 'typing' || (event === 'pet' && this.active?.event !== 'pet')) this.active = null;
    else if (this.active) return;
    const list = event === 'pet' ? this.motion.personality.petReactions : event === 'typing'
      ? this.motion.personality.typingReactions : this.motion.personality.idleReactions;
    const available = list.filter(r => now >= (this.cooldowns.get(r) ?? -Infinity));
    let value = this.random() * available.reduce((n, r) => n + r.weight, 0);
    for (const reaction of available) {
      value -= reaction.weight;
      if (value < 0) {
        this.active = { reaction, started: now, event };
        this.cooldowns.set(reaction, now + reaction.durationMs + reaction.cooldownMs);
        break;
      }
    }
  }

  snapshot(now:number):{energy:number;inside:boolean;reaction:CharacterReactionState|null} {
    this.tick(now);
    const active=this.active;
    const pool=active?.event==='pet'?this.motion.personality.petReactions:active?.event==='typing'
      ?this.motion.personality.typingReactions:this.motion.personality.idleReactions;
    return {energy:this.energy,inside:this.over,reaction:active?{event:active.event as CharacterReactionState['event'],
      index:pool.indexOf(active.reaction),elapsedMs:Math.max(0,now-active.started)}:null};
  }
  follow(energy:number,inside:boolean,reaction:CharacterReactionState|null,now:number,ageMs:number):void {
    this.reset(this.privacy);this.energy=energy;this.over=inside;this.lastEnergyAt=now-ageMs;
    if(reaction&&!this.privacy){
      const pool=reaction.event==='pet'?this.motion.personality.petReactions:reaction.event==='typing'
        ?this.motion.personality.typingReactions:this.motion.personality.idleReactions;
      const selected=pool[reaction.index];
      if(selected&&reaction.elapsedMs+ageMs<selected.durationMs)this.active={reaction:selected,
        started:now-reaction.elapsedMs-ageMs,event:reaction.event};
    }
    this.tick(now);
  }

  pose(now: number): { x: number; y: number; angle: number; reaction: Reaction | null; event: string | null } {
    this.tick(now);
    if (!this.active || this.privacy) return { x: 0, y: 0, angle: 0, reaction: null, event: null };
    const r = this.active.reaction, t = Math.min(1, Math.max(0, (now - this.active.started) / r.durationMs));
    const envelope = Math.sin(Math.PI * t);
    const wave = r.motion === 'nod' ? Math.sin(Math.PI * 2 * t) * envelope : envelope;
    return { x: r.offsetPx[0] * envelope, y: r.offsetPx[1] * wave,
      angle: r.rotationRad * wave, reaction: r, event: this.active.event };
  }
}
