import type { Motion2d } from './characterMotion2d.ts';
import { CharacterInteraction } from './characterInteraction.ts';
import type { CharacterContinuousState } from './characterSync.ts';
export type SpriteSet = Record<'idle' | 'blink' | 'shy' | 'happy', HTMLImageElement>;
export interface ProceduralLayout {
  logicalW: number;
  kbCenterX: number;
  kbCenterY: number;
  kbWidth: number;
  kbHeight: number;
  kbTiltRad: number;
  mouseBtnX: number;
  mouseBtnY: number;
  mouseNX: number;
  mouseLeft: boolean;
  mouseRight: boolean;
  mouseActiveAt: number;
  mouseClickAt: number;
  petEnergy: number;
  privacyMode: boolean;
  privacyTypingAt: number;
  is108: boolean;
}

interface HandState {
  x: number;
  y: number;
  tx: number;
  ty: number;
  lastAt: number;
  squash: number;
  heldVks: Set<number>;
}

interface WaterRipple {
  x: number;
  y: number;
  r: number;
  life: number;
}

interface FloatingParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  kind: 'heart' | 'drop';
}

/**
 * Shared procedural 2D player, adapted from KuroCat BigFish. Rig, motion,
 * interaction, appearance and personality come from the selected validated protocol.
 * Uses MIT-licensed `PC2005-cloud/dsh-pet` (via `QCYTSN/dsh-dafeiyu`) armless/tailless sprites
 * with Live2D-style eye gaze tracking toward mouse/keyboard, procedural pure-round chibi hands,
 * plump flared maid sleeves, animated ocean-blue whale tail slapping right-edge keys,
 * calm hysteresis-locked typing-speed cheek blush, 3-limb simultaneous mouse+keyboard+tail
 * support, and adorable hands-covering-eyes password privacy mode.
 */
export class ProceduralCharacterRenderer {
  private sprites: SpriteSet;
  readonly interaction: CharacterInteraction;
  private clock: () => number;
  private random: () => number;
  private full = false;
  private privacy = false;
  private following=false;
  private phaseOffset=0;
  private pose = { x: 0, y: 0, angle: 0, reaction: null, event: null } as ReturnType<CharacterInteraction['pose']>;
  get petEnergy(): number { return this.interaction.energy; }
  get motion(): Motion2d { return this.protocol; }
  hitTest(x: number, y: number): boolean {
    const l = this.full ? this.protocol.layouts.full : this.protocol.layouts.compact;
    return ((x-l.petEllipseCenter[0])/l.petEllipseRadius[0])**2 + ((y-l.petEllipseCenter[1])/l.petEllipseRadius[1])**2 <= 1;
  }
  onWindowCursor(x: number, y: number, allowed: boolean, released: boolean, full: boolean): void {
    this.full = full;
    if(!this.following)this.interaction.cursor(x, y, allowed, released, full, this.clock());
  }
  hasHeldKey(vk:number): boolean { return this.leftHand.heldVks.has(vk)||this.rightHand.heldVks.has(vk)||this.tail.heldVks.has(vk); }
  debugState() {
    return { petEnergy: this.petEnergy, leftHeld: this.leftHand.heldVks.size, rightHeld: this.rightHand.heldVks.size,
      tailHeld: this.tail.heldVks.size, moodTier: this.moodTier, privacy: this.privacy, particles: this.particles.length,
      expression: this.expression(this.clock()), reaction: this.pose.reaction?.motion ?? null };
  }
  setFollowing(active:boolean):void {this.following=active;this.phaseOffset=0;this.onPrivacyModeChanged(this.privacy);}
  continuousState():CharacterContinuousState {
    const now=this.clock(),interaction=this.interaction.snapshot(now);
    return {privacy:this.privacy,petEnergy:interaction.energy,petInside:interaction.inside,moodTier:this.moodTier,
      typingHeat:this.typingHeat,blushLevel:this.blushLevel,blinkRemainingMs:Math.max(0,this.blinkUntil-now),
      phaseMs:now+this.phaseOffset,reaction:interaction.reaction};
  }
  applyContinuousState(state:CharacterContinuousState,ageMs:number):void {
    if(!this.following||state.privacy!==this.privacy)return;
    const now=this.clock();
    this.interaction.follow(state.petEnergy,state.petInside,state.reaction,now,ageMs);
    this.pose=this.interaction.pose(now);this.moodTier=state.moodTier;this.typingHeat=state.typingHeat;
    this.blushLevel=state.blushLevel;this.blinkUntil=now+Math.max(0,state.blinkRemainingMs-ageMs);
    this.phaseOffset=state.phaseMs+ageMs-now;
  }
  private expression(now: number): 'idle' | 'blink' | 'shy' | 'happy' {
    if (this.privacy) return 'blink';
    if (this.pose.reaction && this.pose.event === 'pet') return this.pose.reaction.expression;
    if (this.petEnergy > this.protocol.petting.happyThreshold) return 'happy';
    if (this.moodTier === 2) return 'happy';
    if (this.moodTier === 1) return 'shy';
    const reactionExpression=this.pose.reaction?.expression;
    if(now<this.blinkUntil&&(!reactionExpression||reactionExpression==='idle'))return 'blink';
    return reactionExpression??'idle';
  }
  private hairBangsCanvas: HTMLCanvasElement | null = null;
  private hairBangsAttempted = false;

  private lastKeyAt = -10000;
  private lastKeyGazeAt = -10000;
  private lastKeyPtX = 214;
  private lastKeyPtY = 353;
  private lastMouseClickAt = -10000;
  private keyTimes: number[] = [];
  private typingHeat = 0;
  private blushLevel = 0;
  private moodTier: 0 | 1 | 2 = 0;
  private moodChangedAt = -10000;
  private nextBlinkAt = 0;
  private blinkUntil = 0;

  // Live2D eye gaze offset in native 224x278 sprite pixel coordinates
  private eyeGazeX = 0;
  private eyeGazeY = 0;

  private bodyShiftX = 0;
  private bodyShiftVel = 0;
  private bodyShiftTarget = 0;
  private bodyTilt = 0;
  private bodyTiltVel = 0;
  private bodyTiltTarget = 0;
  private bodyDiveY = 0;
  private bodyBob = 0;

  private leftHand: HandState = {
    x: 155,
    y: 312,
    tx: 155,
    ty: 312,
    lastAt: -10000,
    squash: 0,
    heldVks: new Set(),
  };
  private rightHand: HandState = {
    x: 235,
    y: 312,
    tx: 235,
    ty: 312,
    lastAt: -10000,
    squash: 0,
    heldVks: new Set(),
  };

  private tail = {
    relX: 84,
    relY: -36,
    activeWag: 0,
    slapAt: -10000,
    releaseAt: -10000,
    slapTargetX: 340,
    slapTargetY: 355,
    heldVks: new Set<number>(),
    squash: 0,
    phase: 0,
  };

  private ripples: WaterRipple[] = [];
  private particles: FloatingParticle[] = [];

  readonly protocol: Motion2d;
  constructor(protocol: Motion2d, sprites: SpriteSet,
    options: { clock?: () => number; random?: () => number } = {}) {
    this.protocol = protocol;
    this.clock = options.clock ?? (() => performance.now());
    this.random = options.random ?? Math.random;
    this.sprites = sprites;
    this.interaction = new CharacterInteraction(protocol, this.random);
    this.nextBlinkAt = this.clock() + this.interval(protocol.blink.firstDelayMs);
  }
  private interval(range: [number, number]): number { return range[0] + this.random() * (range[1] - range[0]); }

  public onPrivacyModeChanged(active: boolean): void {
    this.privacy = active;
    this.interaction.reset(active);
    this.leftHand.heldVks.clear(); this.rightHand.heldVks.clear(); this.tail.heldVks.clear();
    this.leftHand.lastAt = this.rightHand.lastAt = this.tail.slapAt = this.tail.releaseAt = -10000;
    this.lastKeyAt = this.lastKeyGazeAt = this.lastMouseClickAt = -10000;
    this.keyTimes.length = 0; this.typingHeat = this.moodTier = this.blushLevel = 0;
    this.tail.phase = 0; this.ripples.length = 0; this.particles.length = 0;
    this.pose = this.interaction.pose(this.clock());
    this.phaseOffset=0;this.blinkUntil=0;
  }

  public onPrivacyTyping(): void {
    this.bodyBob = Math.min(0.65, this.bodyBob + this.protocol.privacy.typingBob);
  }

  public resetLeftHandForMouse(): void {
    this.leftHand.lastAt = -10000;
  }

  public onMouseAction(now: number = this.clock()): void {
    this.lastMouseClickAt = now;
  }

  public getHandBusyState(now: number): { leftHeld: number; rightHeld: number; rightBusy: boolean } {
    const leftHeld = this.leftHand.heldVks.size;
    const rightHeld = this.rightHand.heldVks.size;
    const rightBusy = rightHeld > 0 || now - this.rightHand.lastAt < this.protocol.hands.busyMs;
    return { leftHeld, rightHeld, rightBusy };
  }

  public triggerTailPreview(pt: { x: number; y: number }, layout: ProceduralLayout): void {
    if (layout.privacyMode || !this.protocol.tail.enabled) return;
    const now = this.clock();
    this.lastKeyGazeAt = now;
    this.lastKeyPtX = pt.x;
    this.lastKeyPtY = pt.y;
    this.tail.slapAt = now;
    this.tail.releaseAt = now + 220;
    this.tail.slapTargetX = pt.x;
    this.tail.slapTargetY = pt.y;
    this.tail.squash = 1;
    this.bodyBob = Math.min(1.0, this.bodyBob + 0.55);
    const normX = Math.max(-1, Math.min(1, (pt.x - layout.kbCenterX) / (layout.kbWidth * 0.46)));
    this.bodyTiltTarget = normX * 0.065;
    this.bodyShiftTarget = normX * 8;
    this.ripples.push({ x: pt.x, y: pt.y, r: 6, life: 1 });
    this.ripples.push({ x: pt.x, y: pt.y, r: 2, life: 0.85 });
    this.spawnParticles(pt.x, pt.y - 8, 3, true);
  }

  public onKeyDown(
    vk: number,
    pt: { x: number; y: number },
    layout: ProceduralLayout,
    repeat: boolean,
    useTail: boolean,
  ): void {
    if (layout.privacyMode || repeat) return;
    if(!this.following)this.interaction.react('typing', this.clock());
    const now = this.clock();
    this.lastKeyAt = now;
    this.lastKeyGazeAt = now;
    this.lastKeyPtX = pt.x;
    this.lastKeyPtY = pt.y;
    this.keyTimes.push(now);
    this.bodyBob = Math.min(this.protocol.body.bobMax, this.bodyBob + this.protocol.body.bobKick);

    const charX = (layout.is108 ? this.protocol.layouts.full : this.protocol.layouts.compact).bodyCenter[0];
    const normX = Math.max(-1, Math.min(1, (pt.x - layout.kbCenterX) / (layout.kbWidth * 0.46)));
    const mouseBusy = layout.mouseLeft || layout.mouseRight || now - layout.mouseActiveAt < this.protocol.bindings.mouseActiveMs;
    const isLeftSide = pt.x < layout.kbCenterX - 2;

    if (useTail && this.protocol.tail.enabled) {
      // Animated ocean-blue whale tail slap onto any configured/smart key!
      this.tail.slapAt = now;
      this.tail.releaseAt = -10000;
      this.tail.heldVks.add(vk);
      this.tail.slapTargetX = pt.x;
      this.tail.slapTargetY = pt.y;
      this.tail.squash = 1;
      if (!mouseBusy) {
        this.bodyTiltTarget = normX >= 0 ? -0.075 : 0.055;
        this.bodyShiftTarget = normX >= 0 ? -7 : 8;
      }
      this.ripples.push({ x: pt.x, y: pt.y, r: 6, life: 1 });
      this.ripples.push({ x: pt.x, y: pt.y, r: 2, life: 0.85 });
      this.spawnParticles(pt.x, pt.y - 8, 3, true);
    } else if (mouseBusy) {
      // Simultaneous mouse + keyboard: left hand stays glued on mouse, right hand taps main keyboard!
      const shiftBase = (layout.is108 ? this.protocol.layouts.full : this.protocol.layouts.compact).mouseBodyShift + (layout.is108 ? 37 : 0);
      const curCharX = charX + shiftBase;
      const comfortX = Math.max(curCharX - 10, Math.min(curCharX + 92, pt.x));
      const comfortY = Math.min(layout.kbCenterY + 6, pt.y);
      this.rightHand.tx = comfortX;
      this.rightHand.ty = comfortY;
      this.rightHand.lastAt = now;
      this.rightHand.squash = 1;
      this.rightHand.heldVks.add(vk);
    } else {
      // Cozy two-handed typing with gentle micro-sway (±5.5°)
      this.bodyTiltTarget = normX * this.protocol.body.typingTiltRad;
      this.bodyShiftTarget = normX * this.protocol.body.typingShiftPx[layout.is108 ? 1 : 0];
      const comfortX =
        charX +
        this.bodyShiftTarget +
        Math.max(-this.protocol.hands.comfortReachPx, Math.min(this.protocol.hands.comfortReachPx, (pt.x - charX) * 0.78));
      const comfortY = Math.min(layout.kbCenterY + 10, pt.y);
      if (isLeftSide) {
        this.leftHand.tx = comfortX;
        this.leftHand.ty = comfortY;
        this.leftHand.lastAt = now;
        this.leftHand.squash = 1;
        this.leftHand.heldVks.add(vk);
      } else {
        this.rightHand.tx = comfortX;
        this.rightHand.ty = comfortY;
        this.rightHand.lastAt = now;
        this.rightHand.squash = 1;
        this.rightHand.heldVks.add(vk);
      }
    }
  }

  public onKeyUp(vk: number): void {
    const now = this.clock();
    this.leftHand.heldVks.delete(vk);
    this.rightHand.heldVks.delete(vk);
    if (this.tail.heldVks.has(vk)) {
      this.tail.heldVks.delete(vk);
      if (this.tail.heldVks.size === 0) {
        this.tail.releaseAt = now;
      }
    }
  }

  private spawnParticles(x: number, y: number, count: number, onlyDrop: boolean): void {
    if ((onlyDrop && !this.protocol.particles.waterEnabled) || (!onlyDrop && !this.protocol.particles.heartsEnabled)) return;
    count = Math.min(count, Math.max(0, this.protocol.particles.maxCount - this.particles.length));
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (this.random() - 0.5) * (onlyDrop ? 28 : 48),
        y: y + (this.random() - 0.5) * 16,
        vx: this.protocol.particles.velocityPxPerSecond[0] / 60 + (this.random() - 0.5) * (onlyDrop ? 2.2 : 0.8),
        vy: this.protocol.particles.velocityPxPerSecond[1] / 60 - this.random() * 1.2,
        life: 1,
        kind: onlyDrop ? 'drop' : this.random() > 0.45 ? 'heart' : 'drop',
      });
    }
  }

  public update(dt: number, now: number, layout: ProceduralLayout): void {
    this.full = layout.is108;
    this.ripples = this.protocol.particles.waterEnabled && this.protocol.particles.maxCount > 0
      ? this.ripples.slice(-this.protocol.particles.maxCount) : [];
    if (this.privacy !== layout.privacyMode) this.onPrivacyModeChanged(layout.privacyMode);
    this.pose = this.interaction.pose(now);
    if (!this.following && !this.pose.reaction && now - this.lastKeyAt > this.protocol.bindings.typingActiveMs) this.interaction.react('idle', now);
    this.bodyBob *= Math.exp(-this.protocol.body.bobDecay * dt);

    const isHappy = !layout.privacyMode && this.petEnergy > this.protocol.petting.happyThreshold;
    const isTyping =
      !layout.privacyMode &&
      (now - this.lastKeyAt < this.protocol.bindings.typingActiveMs ||
        this.tail.heldVks.size > 0 ||
        this.leftHand.heldVks.size > 0 ||
        this.rightHand.heldVks.size > 0);
    const mouseMode =
      !layout.privacyMode &&
      !isHappy &&
      (layout.mouseLeft || layout.mouseRight || now - layout.mouseActiveAt < this.protocol.bindings.mouseActiveMs);

    // 1) Calm 2.8s typing-speed window + hysteresis-locked blush mood (min 2.2s dwell, zero flicker!)
    while (this.keyTimes.length && now - this.keyTimes[0] > this.protocol.mood.sampleWindowMs) {
      this.keyTimes.shift();
    }
    if(!this.following){
      const typingCPS = this.keyTimes.length / (this.protocol.mood.sampleWindowMs / 1000);
      const heatTarget = layout.privacyMode
        ? 0
        : Math.min(1, Math.max(0, (typingCPS - this.protocol.mood.cpsStart) / this.protocol.mood.cpsSpan));
      if (heatTarget > this.typingHeat) {
        this.typingHeat += (heatTarget - this.typingHeat) * (1 - Math.exp(-this.protocol.mood.heatRise * dt));
      } else {
        this.typingHeat += (heatTarget - this.typingHeat) * (1 - Math.exp(-this.protocol.mood.heatFall * dt));
      }

      const dwell = now - this.moodChangedAt;
      if (this.moodTier === 0) {
        if (this.typingHeat >= this.protocol.mood.riseThresholds[0] && dwell >= this.protocol.mood.riseDwellMs[0]) {
          this.moodTier = 1;
          this.moodChangedAt = now;
        }
      } else if (this.moodTier === 1) {
        if (this.typingHeat >= this.protocol.mood.riseThresholds[1] && dwell >= this.protocol.mood.riseDwellMs[1]) {
          this.moodTier = 2;
          this.moodChangedAt = now;
        } else if (this.typingHeat < this.protocol.mood.fallThresholds[0] && dwell >= this.protocol.mood.fallDwellMs[0]) {
          this.moodTier = 0;
          this.moodChangedAt = now;
        }
      } else if (this.moodTier === 2) {
        if (this.typingHeat < this.protocol.mood.fallThresholds[1] && dwell >= this.protocol.mood.fallDwellMs[1]) {
          this.moodTier = 1;
          this.moodChangedAt = now;
        }
      }

      const targetBlush = Math.max(
        this.typingHeat * this.protocol.mood.blushHeatFactor,
        isHappy ? this.protocol.mood.blushPetMinimum : 0,
        layout.privacyMode ? this.protocol.mood.blushPrivacyMinimum : 0,
        this.protocol.mood.blushByTier[this.moodTier],
      );
      this.blushLevel += (targetBlush - this.blushLevel) * (1 - Math.exp(-this.protocol.mood.blushRate * dt));
    }

    // Natural calm blinking every 4.5 - 7.2s
    if (!this.following && now >= this.nextBlinkAt) {
      this.blinkUntil = now + this.protocol.blink.closedMs;
      this.nextBlinkAt = now + this.interval(this.protocol.blink.intervalMs);
    }

    const charX = (layout.is108 ? this.protocol.layouts.full : this.protocol.layouts.compact).bodyCenter[0];
    if (isHappy && this.protocol.particles.heartsEnabled && this.random() < 1 - Math.exp(-this.protocol.particles.petPerSecond * dt)) {
      this.spawnParticles(charX + this.bodyShiftX, 120, 1, false);
    } else if (!layout.privacyMode && this.moodTier === 2 && this.protocol.particles.waterEnabled && this.random() < 1 - Math.exp(-this.protocol.particles.hotTypingPerSecond * dt)) {
      this.spawnParticles(charX + this.bodyShiftX, 124, 1, false);
    }

    // 2) Body spring physics
    if (layout.privacyMode) {
      this.bodyShiftTarget = 0;
      const shySway =
        Math.sin((now+this.phaseOffset) * this.protocol.privacy.bodyRadiansPerSecond / 1000) * this.protocol.privacy.bodySwayRad +
        (now - layout.privacyTypingAt < this.protocol.privacy.typingWindowMs ? Math.sin((now+this.phaseOffset) * this.protocol.privacy.coverRadiansPerSecond / 200) * this.protocol.privacy.typingSwayRad : 0);
      this.bodyTiltTarget = shySway;
      this.bodyDiveY *= Math.exp(-this.protocol.body.returnRate * dt);
    } else if (mouseMode) {
      const baseShift = (layout.is108 ? this.protocol.layouts.full : this.protocol.layouts.compact).mouseBodyShift;
      this.bodyShiftTarget = baseShift + (layout.mouseNX - 0.5) * this.protocol.body.mouseFollowPx;
      this.bodyTiltTarget = this.protocol.body.mouseTiltRad;
      this.bodyDiveY += (this.protocol.body.mouseDivePx - this.bodyDiveY) * (1 - Math.exp(-this.protocol.body.mouseDiveRate * dt));
    } else if (!isTyping) {
      this.bodyShiftTarget = 0;
      this.bodyTiltTarget = 0;
      this.bodyDiveY *= Math.exp(-this.protocol.body.returnRate * dt);
    } else {
      this.bodyDiveY *= Math.exp(-this.protocol.body.returnRate * dt);
    }

    const shiftAcc = (this.bodyShiftTarget - this.bodyShiftX) * this.protocol.body.spring.stiffness - this.bodyShiftVel * this.protocol.body.spring.damping;
    this.bodyShiftVel += shiftAcc * dt;
    this.bodyShiftX += this.bodyShiftVel * dt;

    const tiltAcc = (this.bodyTiltTarget - this.bodyTilt) * this.protocol.body.tiltSpring.stiffness - this.bodyTiltVel * this.protocol.body.tiltSpring.damping;
    this.bodyTiltVel += tiltAcc * dt;
    this.bodyTilt += this.bodyTiltVel * dt;

    // 2a) Live2D eye gaze tracking toward active mouse click / keyboard key / whale-tail slap!
    const lastClickTs = Math.max(this.lastMouseClickAt, layout.mouseClickAt || -10000);
    const activeMouseClick =
      !layout.privacyMode &&
      !isHappy &&
      (layout.mouseLeft || layout.mouseRight || now - lastClickTs < this.protocol.gaze.activeMs);
    const activeKeyGaze =
      !layout.privacyMode &&
      !isHappy &&
      (now - this.lastKeyGazeAt < this.protocol.gaze.activeMs ||
        this.leftHand.heldVks.size > 0 ||
        this.rightHand.heldVks.size > 0 ||
        this.tail.heldVks.size > 0);

    let gazeTx = 0;
    let gazeTy = 0;
    let hasActiveLookTarget = false;
    let targetWX = 0;
    let targetWY = 0;

    if (activeMouseClick && (!activeKeyGaze || lastClickTs >= this.lastKeyGazeAt)) {
      hasActiveLookTarget = true;
      targetWX = layout.mouseBtnX;
      targetWY = layout.mouseBtnY;
    } else if (activeKeyGaze) {
      hasActiveLookTarget = true;
      targetWX = this.lastKeyPtX;
      targetWY = this.lastKeyPtY;
    } else if (mouseMode) {
      hasActiveLookTarget = true;
      targetWX = layout.mouseBtnX;
      targetWY = layout.mouseBtnY;
    }

    if (hasActiveLookTarget) {
      const g = this.computeGeom(now, layout);
      const eyeWorld = g.spritePointToWorld(0.49, 0.495);
      const wdx = targetWX - eyeWorld.x;
      const wdy = targetWY - eyeWorld.y;
      const c = Math.cos(-this.bodyTilt - this.pose.angle);
      const s = Math.sin(-this.bodyTilt - this.pose.angle);
      const localDx = wdx * c - wdy * s;
      const localDy = wdx * s + wdy * c;
      gazeTx = Math.max(this.protocol.gaze.horizontalRangePx[0], Math.min(this.protocol.gaze.horizontalRangePx[1], localDx / this.protocol.gaze.targetDivisor[0]));
      gazeTy = Math.max(this.protocol.gaze.verticalRangePx[0], Math.min(this.protocol.gaze.verticalRangePx[1], localDy / this.protocol.gaze.targetDivisor[1]));
    }

    const gazeRate = hasActiveLookTarget ? this.protocol.gaze.activeRate : this.protocol.gaze.returnRate;
    const gazeLerp = 1 - Math.exp(-gazeRate * dt);
    this.eyeGazeX += (gazeTx - this.eyeGazeX) * gazeLerp;
    this.eyeGazeY += (gazeTy - this.eyeGazeY) * gazeLerp;

    // 2b) Whale tail physics (relative to waist anchor so rapid body shifts NEVER detach the tail!)
    const gTail = this.computeGeom(now, layout);
    const tailRoot = gTail.spritePointToWorld(...this.protocol.rig.tailRoot);
    const wagSpeed = (isHappy ? this.protocol.tail.idleRadiansPerSecond[2] : this.typingHeat > .45
      ? this.protocol.tail.hotTypingRadiansPerSecond : isTyping ? this.protocol.tail.idleRadiansPerSecond[1]
      : this.protocol.tail.idleRadiansPerSecond[0]) / 1000;
    const animationNow=now+this.phaseOffset;
    const idleWag = Math.sin(animationNow * wagSpeed) * (isHappy ? this.protocol.tail.idleWagRadians[1] : this.protocol.tail.idleWagRadians[0] * (1 + this.typingHeat));
    const maxIdleOffX = Math.max(54, Math.min(this.protocol.tail.idleOffset[0], layout.logicalW - 26 - tailRoot.x));
    const idleOffX = maxIdleOffX + Math.sin(animationNow * wagSpeed) * 9;
    const idleOffY = this.protocol.tail.idleOffset[1] + Math.cos(animationNow * wagSpeed * 1.15) * 7;

    const tailAge = Math.max(0, now - this.tail.slapAt);
    const holdingSlap =
      !layout.privacyMode &&
      (this.tail.heldVks.size > 0 || (this.tail.slapAt > 0 && tailAge < this.protocol.tail.holdMs));
    let targetPhase = 0;
    if (holdingSlap) {
      targetPhase = Math.min(1, tailAge / this.protocol.tail.extendMs);
    } else if (!layout.privacyMode && this.tail.slapAt > 0) {
      const holdEnd = Math.max(this.tail.slapAt + this.protocol.tail.holdMs, this.tail.releaseAt);
      const retElapsed = Math.max(0, now - holdEnd);
      targetPhase = Math.max(0, 1 - retElapsed / this.protocol.tail.releaseMs);
    }
    this.tail.phase += (targetPhase - this.tail.phase) * (1 - Math.exp(-this.protocol.tail.phaseRate * dt));
    if (this.tail.phase < 0.002 && targetPhase === 0) this.tail.phase = 0;

    const slapOffX = this.tail.slapTargetX - tailRoot.x;
    const slapOffY = this.tail.slapTargetY - tailRoot.y;
    const targetRelX = idleOffX + (slapOffX - idleOffX) * this.tail.phase;
    const targetRelY = idleOffY + (slapOffY - idleOffY) * this.tail.phase;
    const tLerp = 1 - Math.exp(-this.protocol.tail.followRate * dt);
    this.tail.relX += (targetRelX - this.tail.relX) * tLerp;
    this.tail.relY += (targetRelY - this.tail.relY) * tLerp;
    this.tail.squash *= Math.exp(-this.protocol.tail.squashDecay * dt);
    this.tail.activeWag = idleWag * (1 - this.tail.phase) + -0.08 * this.tail.phase;

    // 3) Ripples & particles
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += this.protocol.particles.rippleSpeedPxPerSecond * dt;
      rp.life -= 2.2 * dt;
      if (rp.life <= 0) this.ripples.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.life -= dt * 1000 / this.protocol.particles.lifetimeMs;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private computeGeom(now: number, layout: ProceduralLayout) {
    const charX = (layout.is108 ? this.protocol.layouts.full : this.protocol.layouts.compact).bodyCenter[0];
    const config = layout.is108 ? this.protocol.layouts.full : this.protocol.layouts.compact;
    const baseCharY = config.bodyCenter[1];
    const breath = Math.sin((now+this.phaseOffset) * this.protocol.body.breathRadiansPerSecond / 1000) * this.protocol.body.breathAmplitudePx + this.bodyBob * this.protocol.body.bobBreathScale + this.bodyDiveY;
    const charCenterX = charX + this.bodyShiftX + this.pose.x;
    const charBaseY = baseCharY + breath + this.pose.y;
    const drawW = config.drawWidth;
    const drawH = drawW * (this.protocol.rig.sourceSize[1] / this.protocol.rig.sourceSize[0]);
    const pivotOff = config.pivotOffset;
    const pivotY = charBaseY - pivotOff;

    const spritePointToWorld = (normX: number, normY: number) => {
      const lx = (normX - 0.5) * drawW;
      const ly = normY * drawH - drawH + pivotOff;
      const c = Math.cos(this.bodyTilt + this.pose.angle);
      const s = Math.sin(this.bodyTilt + this.pose.angle);
      return {
        x: charCenterX + lx * c - ly * s,
        y: pivotY + lx * s + ly * c,
      };
    };

    return {
      charCenterX,
      charBaseY,
      drawW,
      drawH,
      pivotOff,
      pivotY,
      spritePointToWorld,
    };
  }

  private ensureHairBangsCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
    if (!this.protocol.rig.hairOcclusion.enabled) return null;
    if (this.hairBangsAttempted) return this.hairBangsCanvas;
    if (!img.complete || img.naturalWidth <= 0) return null;
    this.hairBangsAttempted = true;
    try {
      const [cropX, cropY, cropW, cropH] = this.protocol.rig.hairOcclusion.crop;
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = 224;
      srcCanvas.height = 278;
      const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
      if (!sctx) return null;
      sctx.drawImage(img, 0, 0, 224, 278);
      const idata = sctx.getImageData(cropX, cropY, cropW, cropH);
      const d = idata.data;
      for (let ly = 0; ly < cropH; ly++) {
        const y = cropY + ly;
        for (let lx = 0; lx < cropW; lx++) {
          const x = cropX + lx;
          const idx = (ly * cropW + lx) * 4;
          const r = d[idx];
          const g = d[idx + 1];
          const b = d[idx + 2];
          const a = d[idx + 3];
          const mask = this.protocol.rig.hairOcclusion;
          const inRegion = mask.regions.some(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
          const fallback = mask.fallbackRgbMax;
          const isHairPixel = a > mask.alphaMin && ((r < mask.redMax && b >= r + mask.blueMinusRedMin)
            || (r < fallback[0] && g < fallback[1] && b < fallback[2]));
          if (!(inRegion && isHairPixel)) {
            d[idx + 3] = 0;
          }
        }
      }
      const out = document.createElement('canvas');
      out.width = cropW;
      out.height = cropH;
      const octx = out.getContext('2d');
      if (!octx) return null;
      octx.putImageData(idata, 0, 0);
      this.hairBangsCanvas = out;
      return out;
    } catch {
      return null;
    }
  }

  private traceClosedSpline(
    ctx: CanvasRenderingContext2D,
    pts: ReadonlyArray<readonly [number, number]>,
  ): void {
    const n = pts.length;
    if (n < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
    }
    ctx.closePath();
  }

  /**
   * Draws Live2D-style moving sapphire eyes in native 224x278 sprite space when looking toward mouse/keyboard.
   * Smoothly crossfades to 100% original untouched sprite pixels when looking straight ahead at rest.
   */
  private renderLiveEyes(
    ctx: CanvasRenderingContext2D,
    gazeX: number,
    gazeY: number,
    idleImg: HTMLImageElement,
  ): void {
    const gazeMag = Math.hypot(gazeX, gazeY);
    const alpha = Math.min(1, gazeMag / 0.55);
    if (alpha <= 0.02) return;

    const eyes = this.protocol.rig.eyes.map((eye, index) => ({
      side: index === 0 ? -1 : 1, ix: eye.center[0], iy: eye.center[1],
      irx: eye.radius[0], iry: eye.radius[1], pts: eye.clip,
    }));

    ctx.save();
    ctx.globalAlpha = alpha;

    for (const e of eyes) {
      ctx.save();
      this.traceClosedSpline(ctx, e.pts);
      ctx.clip();

      // 1) Warm anime sclera + cool-lavender upper-lash cast shadow
      const minX=Math.min(...e.pts.map(point=>point[0])),maxX=Math.max(...e.pts.map(point=>point[0]));
      const minY=Math.min(...e.pts.map(point=>point[1])),maxY=Math.max(...e.pts.map(point=>point[1]));
      const scleraGrad = ctx.createLinearGradient(0, minY, 0, maxY);
    for (const stop of this.protocol.gaze.scleraGradient) scleraGrad.addColorStop(stop.offset, stop.color);
      ctx.fillStyle = scleraGrad;
      ctx.fillRect(minX-2, minY-2, maxX-minX+4, maxY-minY+4);

      // 2) Moving ocean-sapphire iris (matched 1:1 to notail_idle.png)
      const icx = e.ix + gazeX;
      const icy = e.iy + gazeY;
      const irx = e.irx;
      const iry = e.iry;

      ctx.fillStyle = '#1a2446';
      ctx.beginPath();
      ctx.ellipse(icx, icy, irx, iry, 0, 0, Math.PI * 2);
      ctx.fill();

      const irisGrad = ctx.createLinearGradient(icx, icy - iry * 0.92, icx, icy + iry * 0.92);
    for (const stop of this.protocol.gaze.irisGradient) irisGrad.addColorStop(stop.offset, stop.color);
      ctx.fillStyle = irisGrad;
      ctx.beginPath();
      ctx.ellipse(icx, icy, irx * 0.91, iry * 0.91, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(164, 226, 248, 0.62)';
      ctx.beginPath();
      ctx.ellipse(icx, icy + iry * 0.44, irx * 0.62, iry * 0.30, 0, 0, Math.PI * 2);
      ctx.fill();

      // Deep central pupil with subtle gaze parallax
      const pcx = icx + gazeX * this.protocol.gaze.pupilParallax;
      const pcy = icy + gazeY * this.protocol.gaze.pupilParallax - 0.4;
      const prx = irx * 0.42;
      const pry = iry * 0.46;
      ctx.fillStyle = this.protocol.gaze.pupilColor;
      ctx.beginPath();
      ctx.ellipse(pcx, pcy, prx, pry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(4, 18, 52, 0.96)';
      ctx.beginPath();
      ctx.ellipse(pcx, pcy, prx * 0.52, pry * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();

      // Soft upper-lash shadow across top of iris
      ctx.fillStyle = 'rgba(18, 28, 64, 0.40)';
      ctx.beginPath();
      ctx.ellipse(icx, icy - iry * 0.72, irx * 0.95, iry * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();

      // Glossy starlight catchlights
      const hlX = icx + (e.side === -1 ? 0.6 : -0.3);
      const hlY = icy - iry * 0.50;
      ctx.fillStyle = this.protocol.gaze.highlightColor;
      ctx.beginPath();
      ctx.arc(hlX, hlY, 2.1, 0, Math.PI * 2);
      ctx.fill();

      const hl2X = icx + (e.side === -1 ? -3.4 : 3.4);
      const hl2Y = icy + iry * 0.30;
      ctx.fillStyle = 'rgba(235, 250, 255, 0.78)';
      ctx.beginPath();
      ctx.arc(hl2X, hl2Y, 0.85, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // Re-composite exact center bangs & outer side hair ON TOP of eye sockets!
    const bangs = this.ensureHairBangsCanvas(idleImg);
    if (bangs) {
      ctx.drawImage(bangs, this.protocol.rig.hairOcclusion.crop[0], this.protocol.rig.hairOcclusion.crop[1]);
    }

    ctx.restore();
  }

  /** Layer 1 (drawn BEFORE keyboard & mouse): waist-anchored whale tail + BigFish sprite + Live2D eyes + soft blush. */
  public renderBody(ctx: CanvasRenderingContext2D, now: number, layout: ProceduralLayout): void {
    const g = this.computeGeom(now, layout);
    const isHappy = !layout.privacyMode && this.petEnergy > this.protocol.petting.happyThreshold;
    const isBlinking = now < this.blinkUntil;

    // Draw whale tail behind body sprite & keyboard so its root emerges naturally from her waist
    // and NEVER floats on top of the keyboard or detaches when shifting left for mouseMode (Fixes #11).
    const tailRoot = g.spritePointToWorld(...this.protocol.rig.tailRoot);
    const tipX = tailRoot.x + this.tail.relX;
    const tipY = tailRoot.y + this.tail.relY;
    this.drawWhaleTail(
      ctx,
      tailRoot.x,
      tailRoot.y,
      tipX,
      tipY,
      this.tail.phase,
      this.tail.activeWag,
      layout.logicalW,
      'back',
    );

    const exprKey = this.expression(now);
    const img = this.sprites[exprKey] || this.sprites.idle;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, layout.logicalW, layout.kbCenterY - layout.kbHeight * this.protocol.body.keyboardClipFactor);
      ctx.clip();
      ctx.translate(g.charCenterX, g.pivotY);
      ctx.rotate(this.bodyTilt + this.pose.angle);
      ctx.scale(1 + this.bodyBob * this.protocol.body.bobScale[0], 1 + this.bodyBob * this.protocol.body.bobScale[1]);
      ctx.drawImage(img, -g.drawW * 0.5, -g.drawH + g.pivotOff, g.drawW, g.drawH);

      // Live2D eye gaze toward mouse/keyboard when eyes are open
      if (exprKey === 'idle' && this.protocol.gaze.enabled) {
        ctx.save();
        ctx.translate(-g.drawW * 0.5, -g.drawH + g.pivotOff);
        ctx.scale(g.drawW / 224, g.drawH / 278);
        this.renderLiveEyes(ctx, this.eyeGazeX, this.eyeGazeY, this.sprites.idle);
        ctx.restore();
      }

      // Soft natural watercolor cheek blush strictly BELOW her eyes
      if (this.blushLevel > 0.08) {
        const cheeks = this.protocol.mood.cheekCenters.map(([x,y]) => ({
          x: (x - .5) * g.drawW, y: y * g.drawH - g.drawH + g.pivotOff,
        }));
        for (const ch of cheeks) {
          const rX = this.protocol.mood.cheekRadius[0] + this.blushLevel * 4.5;
          const rY = this.protocol.mood.cheekRadius[1] + this.blushLevel * 2.2;
          const grad = ctx.createRadialGradient(ch.x, ch.y, 1, ch.x, ch.y, rX);
          grad.addColorStop(0, `rgba(255, 110, 148, ${(this.blushLevel * 0.46).toFixed(3)})`);
          grad.addColorStop(0.55, `rgba(255, 138, 170, ${(this.blushLevel * 0.22).toFixed(3)})`);
          grad.addColorStop(1, 'rgba(255, 140, 170, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(ch.x, ch.y, rX, rY, 0, 0, Math.PI * 2);
          ctx.fill();

          if (this.blushLevel > 0.52) {
            const lineA = Math.min(1, (this.blushLevel - 0.52) / 0.40) * 0.36;
            ctx.strokeStyle = `rgba(235, 88, 132, ${lineA.toFixed(3)})`;
            ctx.lineWidth = 1.05;
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (const ox of [-3.4, 0, 3.4]) {
              ctx.moveTo(ch.x + ox - 0.9, ch.y + 1.8);
              ctx.lineTo(ch.x + ox + 1.0, ch.y - 1.5);
            }
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  }

  /** Layer 2 (drawn AFTER keyboard & mouse): water ripples, animated whale tail, plump round hands, particles. */
  public renderForeground(
    ctx: CanvasRenderingContext2D,
    dt: number,
    now: number,
    layout: ProceduralLayout,
  ): void {
    const g = this.computeGeom(now, layout);
    const shL = g.spritePointToWorld(...this.protocol.rig.leftShoulder);
    const shR = g.spritePointToWorld(...this.protocol.rig.rightShoulder);
    const tailRoot = g.spritePointToWorld(...this.protocol.rig.tailRoot);

    const isHappy = !layout.privacyMode && this.petEnergy > this.protocol.petting.happyThreshold;
    const mouseMode =
      !layout.privacyMode &&
      !isHappy &&
      (layout.mouseLeft || layout.mouseRight || now - layout.mouseActiveAt < this.protocol.bindings.mouseActiveMs);

    // 1) Water slap ripples on keyboard
    for (const rp of this.ripples) {
      ctx.save();
      ctx.globalAlpha = rp.life * 0.82;
      ctx.strokeStyle = this.protocol.particles.waterColor;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2) Only draw the arching front half & fluke of the whale tail in foreground while slapping a key,
    // keeping the waist root strictly behind her body & keyboard bezel!
    if (this.protocol.tail.enabled && this.tail.phase > 0.12) {
      const tipX = tailRoot.x + this.tail.relX;
      const tipY = tailRoot.y + this.tail.relY;
      this.drawWhaleTail(
        ctx,
        tailRoot.x,
        tailRoot.y,
        tipX,
        tipY,
        this.tail.phase,
        this.tail.activeWag,
        layout.logicalW,
        'front',
      );
    }

    // 3) Pure round chibi hands (covering closed eyes in privacyMode!)
    const leftTyping =
      !layout.privacyMode &&
      !mouseMode &&
      (now - this.leftHand.lastAt < this.protocol.hands.holdMs || this.leftHand.heldVks.size > 0);
    const rightTyping =
      !layout.privacyMode &&
      (now - this.rightHand.lastAt < this.protocol.hands.holdMs || this.rightHand.heldVks.size > 0);

    let lTargetX: number;
    let lTargetY: number;
    let rTargetX: number;
    let rTargetY: number;
    if (layout.privacyMode) {
      const eyeL = g.spritePointToWorld(...this.protocol.rig.coverEyes[0]);
      const eyeR = g.spritePointToWorld(...this.protocol.rig.coverEyes[1]);
      const shyBob = Math.sin((now+this.phaseOffset) * this.protocol.privacy.coverRadiansPerSecond / 1000) * this.protocol.privacy.coverBobPx;
      lTargetX = eyeL.x;
      lTargetY = eyeL.y + shyBob;
      rTargetX = eyeR.x;
      rTargetY = eyeR.y - shyBob;
    } else if (isHappy && (this.pose.event === 'pet' ? this.pose.reaction?.motion === 'cheer'
      : this.protocol.personality.petReactions.every(reaction=>reaction.motion === 'cheer'))) {
      const cheer = Math.sin((now+this.phaseOffset) * this.protocol.hands.cheerRadiansPerSecond / 1000) * this.protocol.hands.cheerAmplitudePx;
      lTargetX = shL.x + this.protocol.hands.cheerOffsets[0][0];
      lTargetY = shL.y + this.protocol.hands.cheerOffsets[0][1] + cheer;
      rTargetX = shR.x + this.protocol.hands.cheerOffsets[1][0];
      rTargetY = shR.y + this.protocol.hands.cheerOffsets[1][1] - cheer;
    } else {
      if (mouseMode) {
        const pressOff = layout.mouseLeft || layout.mouseRight ? this.protocol.hands.mousePressPx : 0;
        lTargetX = layout.mouseBtnX;
        lTargetY = layout.mouseBtnY + pressOff;
      } else if (leftTyping) {
        lTargetX = this.leftHand.tx;
        lTargetY = this.leftHand.ty;
      } else {
        lTargetX = shL.x + this.protocol.hands.idleOffsets[0][0];
        lTargetY = shL.y + this.protocol.hands.idleOffsets[0][1];
      }
      if (rightTyping) {
        rTargetX = this.rightHand.tx;
        rTargetY = this.rightHand.ty;
      } else {
        rTargetX = shR.x + this.protocol.hands.idleOffsets[1][0];
        rTargetY = shR.y + this.protocol.hands.idleOffsets[1][1];
      }
    }

    const hLerp = 1 - Math.exp(-this.protocol.hands.followRate * dt);
    this.leftHand.x += (lTargetX - this.leftHand.x) * hLerp;
    this.leftHand.y += (lTargetY - this.leftHand.y) * hLerp;
    this.rightHand.x += (rTargetX - this.rightHand.x) * hLerp;
    this.rightHand.y += (rTargetY - this.rightHand.y) * hLerp;
    this.leftHand.squash *= Math.exp(-this.protocol.hands.squashDecay * dt);
    this.rightHand.squash *= Math.exp(-this.protocol.hands.squashDecay * dt);

    const maxMouseReach = layout.is108 ? this.protocol.hands.mouseReachFull : this.protocol.hands.mouseReachCompact;
    this.drawChubbyArm(
      ctx,
      shL.x,
      shL.y,
      this.leftHand.x,
      this.leftHand.y,
      'left',
      this.leftHand.squash,
      mouseMode ? maxMouseReach : this.protocol.hands.maxReachPx,
    );
    this.drawChubbyArm(
      ctx,
      shR.x,
      shR.y,
      this.rightHand.x,
      this.rightHand.y,
      'right',
      this.rightHand.squash,
      mouseMode ? this.protocol.hands.rightMouseReach : this.protocol.hands.maxReachPx,
    );

    // 4) Water droplets & hearts
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = '14px sans-serif';
      ctx.fillText(p.kind === 'heart' ? '💙' : '💧', p.x, p.y);
      ctx.restore();
    }
  }

  private drawWhaleTail(
    ctx: CanvasRenderingContext2D,
    rootX: number,
    rootY: number,
    tipX: number,
    tipY: number,
    slapPhase: number,
    wagAngle: number,
    logicalW: number,
    layer: 'back' | 'front',
  ): void {
    if (!this.protocol.tail.enabled) return;
    const idleCtrlX = rootX + 52;
    const idleCtrlY = rootY - 6;
    // Smoothly wrap around the right hip and sweep over the keyboard deck when slapping far-left keys
    // so the whale tail never cuts across her torso or face!
    const crossLeft = Math.max(0, Math.min(1, (rootX + 24 - tipX) / 145));
    const nearSlapCtrlX = Math.min(logicalW - 18, Math.max(rootX + 94, tipX + 42));
    const nearSlapCtrlY = Math.min(rootY - 42, (rootY + tipY) * 0.5 - 64);
    const farSlapCtrlX = Math.min(logicalW - 16, rootX + 104);
    const farSlapCtrlY = Math.max(rootY + 28, tipY - 14);
    const slapCtrlX = nearSlapCtrlX + (farSlapCtrlX - nearSlapCtrlX) * crossLeft;
    const slapCtrlY = nearSlapCtrlY + (farSlapCtrlY - nearSlapCtrlY) * crossLeft;

    const ctrlX = idleCtrlX + (slapCtrlX - idleCtrlX) * slapPhase;
    const ctrlY = idleCtrlY + (slapCtrlY - idleCtrlY) * slapPhase;

    const steps = this.protocol.tail.segments;
    const pts: Array<{ x: number; y: number; nx: number; ny: number; r: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 0.90;
      const omt = 1 - t;
      const x = omt * omt * rootX + 2 * omt * t * ctrlX + t * t * tipX;
      const y = omt * omt * rootY + 2 * omt * t * ctrlY + t * t * tipY;
      const tx = 2 * omt * (ctrlX - rootX) + 2 * t * (tipX - ctrlX);
      const ty = 2 * omt * (ctrlY - rootY) + 2 * t * (tipY - ctrlY);
      const len = Math.max(0.001, Math.hypot(tx, ty));
      const nx = -ty / len;
      const ny = tx / len;
      const r = this.protocol.tail.stemRadius * (t < .14 ? .72 + (t / .14) * .28 : 1 - ((t - .14) / .86) * .56);
      pts.push({ x, y, nx, ny, r });
    }

    const startIdx = layer === 'front' ? Math.floor(steps * this.protocol.tail.frontStart) : 0;
    const drawFluke = layer === 'front' ? true : slapPhase <= 0.12;
    const tipAng = Math.atan2(tipY - ctrlY, tipX - ctrlX) + wagAngle;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (layer === 'front' && slapPhase > 0.25) {
      ctx.save();
      ctx.shadowColor = 'rgba(7, 16, 40, 0.45)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = 'rgba(20, 40, 88, 0.25)';
      ctx.beginPath();
      ctx.ellipse(tipX, tipY + 4, 20, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const stemGrad = ctx.createLinearGradient(rootX, rootY, tipX, tipY);
    for (const stop of this.protocol.tail.stemGradient) stemGrad.addColorStop(stop.offset, stop.color);

    ctx.beginPath();
    ctx.moveTo(
      pts[startIdx].x + pts[startIdx].nx * pts[startIdx].r,
      pts[startIdx].y + pts[startIdx].ny * pts[startIdx].r,
    );
    for (let i = startIdx + 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x + pts[i].nx * pts[i].r, pts[i].y + pts[i].ny * pts[i].r);
    }
    for (let i = pts.length - 1; i >= startIdx; i--) {
      ctx.lineTo(pts[i].x - pts[i].nx * pts[i].r, pts[i].y - pts[i].ny * pts[i].r);
    }
    ctx.closePath();
    ctx.fillStyle = stemGrad;
    ctx.fill();

    const edgeStart = Math.max(1, startIdx);
    ctx.strokeStyle = '#16203d';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = edgeStart; i < pts.length; i++) {
      const px = pts[i].x + pts[i].nx * pts[i].r;
      const py = pts[i].y + pts[i].ny * pts[i].r;
      if (i === edgeStart) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let i = edgeStart; i < pts.length; i++) {
      const px = pts[i].x - pts[i].nx * pts[i].r;
      const py = pts[i].y - pts[i].ny * pts[i].r;
      if (i === edgeStart) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    const hlStart = Math.max(2, startIdx);
    ctx.strokeStyle = 'rgba(170, 232, 255, 0.48)';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    for (let i = hlStart; i < pts.length; i++) {
      const hx = pts[i].x + pts[i].nx * (pts[i].r * 0.35);
      const hy = pts[i].y + pts[i].ny * (pts[i].r * 0.35);
      if (i === hlStart) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.stroke();

    if (!drawFluke) {
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(tipAng);
    const sq = this.tail.squash;
    const scaleMult = 1.05 + slapPhase * 0.10;
    ctx.scale(scaleMult * (1 + sq * 0.16), scaleMult * (1 - sq * 0.10));

    const flukeGrad = ctx.createRadialGradient(-6, 0, 2, 4, 0, 28);
    for (const stop of this.protocol.tail.flukeGradient) flukeGrad.addColorStop(stop.offset, stop.color);

    ctx.fillStyle = flukeGrad;
    ctx.strokeStyle = this.protocol.tail.outline;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-13, -4);
    for (const segment of this.protocol.tail.flukeOutline) {
      ctx.bezierCurveTo(...segment.control1, ...segment.control2, ...segment.end);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(215, 248, 255, 0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.quadraticCurveTo(2, -11, 13, -17);
    ctx.moveTo(-8, 2);
    ctx.quadraticCurveTo(2, 11, 13, 17);
    ctx.moveTo(-6, -1);
    ctx.quadraticCurveTo(1, -6, 8, -9);
    ctx.moveTo(-6, 1);
    ctx.quadraticCurveTo(1, 6, 8, 9);
    ctx.stroke();

    ctx.fillStyle = 'rgba(230, 252, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(-4, -7, 4.2, 2.2, -0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  private drawChubbyArm(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    targetX: number,
    targetY: number,
    side: 'left' | 'right',
    squash: number,
    maxLen: number,
  ): void {
    const dx = targetX - sx;
    const dy = targetY - sy;
    const rawLen = Math.max(1, Math.hypot(dx, dy));
    const len = Math.min(rawLen, maxLen);
    const ux = dx / rawLen;
    const uy = dy / rawLen;
    const px = sx + ux * len;
    const py = sy + uy * len;
    const nx = -uy;
    const ny = ux;
    const ang = Math.atan2(dy, dx);
    const sgn = side === 'left' ? -1 : 1;

    const wristDist = Math.max(14, len - 9);
    const wx = sx + ux * wristDist;
    const wy = sy + uy * wristDist;
    const rSh = this.protocol.hands.style.shoulderRadius;
    const rCuff = this.protocol.hands.style.cuffRadius;
    const midX = (sx + wx) * 0.5 + nx * (sgn * 2.5);
    const midY = (sy + wy) * 0.5 + ny * (sgn * 2.5);

    ctx.save();
    const grad = ctx.createLinearGradient(sx, sy, wx, wy);
    for (const stop of this.protocol.hands.style.sleeveGradient) grad.addColorStop(stop.offset, stop.color);

    ctx.beginPath();
    ctx.moveTo(sx + nx * rSh, sy + ny * rSh);
    ctx.quadraticCurveTo(midX + nx * 11.0, midY + ny * 11.0, wx + nx * rCuff, wy + ny * rCuff);
    ctx.lineTo(wx - nx * rCuff, wy - ny * rCuff);
    ctx.quadraticCurveTo(midX - nx * 11.0, midY - ny * 11.0, sx - nx * rSh, sy - ny * rSh);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, rSh, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = this.protocol.hands.style.sleeveOutline;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + nx * rSh, sy + ny * rSh);
    ctx.quadraticCurveTo(midX + nx * 11.0, midY + ny * 11.0, wx + nx * rCuff, wy + ny * rCuff);
    ctx.moveTo(sx - nx * rSh, sy - ny * rSh);
    ctx.quadraticCurveTo(midX - nx * 11.0, midY - ny * 11.0, wx - nx * rCuff, wy - ny * rCuff);
    ctx.stroke();

    const trimDist = Math.max(8, wristDist - 5.5);
    ctx.save();
    ctx.translate(sx + ux * trimDist, sy + uy * trimDist);
    ctx.rotate(ang + Math.PI / 2);
    ctx.strokeStyle = this.protocol.hands.style.trim;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-rCuff + 2, 0);
    ctx.lineTo(rCuff - 2, 0);
    ctx.stroke();
    ctx.fillStyle = this.protocol.hands.style.button;
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = this.protocol.hands.style.cuff;
    ctx.strokeStyle = this.protocol.hands.style.cuffOutline;
    ctx.lineWidth = 1.8;
    const cuffStyle=this.protocol.hands.style.cuffStyle??'ruffled';
    if(cuffStyle==='ruffled'){
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(i * 4.4, 0, 4.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, -0.5, 10.2, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }else{
      ctx.beginPath();ctx.rect(-rCuff,-3,rCuff*2,6);ctx.fill();ctx.stroke();
      if(cuffStyle==='ribbed'){
        ctx.lineWidth=.8;
        for(let x=-rCuff+2;x<rCuff;x+=3){ctx.beginPath();ctx.moveTo(x,-2.5);ctx.lineTo(x,2.5);ctx.stroke();}
      }
    }
    ctx.restore();

    // Pure round chibi hand (zero thumb!)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = this.protocol.hands.style.skin;
    ctx.strokeStyle = this.protocol.hands.style.skinOutline;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.protocol.hands.style.handRadius[0] * (1 + squash * this.protocol.hands.style.handSquash[0]), this.protocol.hands.style.handRadius[1] * (1 - squash * this.protocol.hands.style.handSquash[1]), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.arc(-2.2, -2.2, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }
}
