import purrMp3Url from './assets/audio/purr.mp3?url';
import tailPokeYowlMp3Url from './assets/audio/tail_poke_yowl.mp3?url';
import handoverYowlMp3Url from './assets/audio/handover_yowl.mp3?url';
import siameseYowl from './handoverLite/yowl.json';

export type TypingSoundSlot =
  | 'k0'
  | 'k1'
  | 'k2'
  | 'k3'
  | 'k4'
  | 'k5'
  | 'k6'
  | 'k7'
  | 'up0'
  | 'up1'
  | 'up2'
  | 'up3'
  | 'space0'
  | 'space1'
  | 'space_up'
  | 'enter'
  | 'enter_up'
  | 'backspace'
  | 'mouse_down0'
  | 'mouse_up0'
  | 'mouse_down1';

const KEY_DOWN_SLOTS: readonly TypingSoundSlot[] = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
const KEY_UP_SLOTS: readonly TypingSoundSlot[] = ['up0', 'up1', 'up2', 'up3'];
const ALL_TYPING_SLOTS: readonly TypingSoundSlot[] = [
  'k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7',
  'up0', 'up1', 'up2', 'up3',
  'space0', 'space1', 'space_up',
  'enter', 'enter_up', 'backspace',
  'mouse_down0', 'mouse_up0', 'mouse_down1',
];
const TYPING_SOUND_URLS = import.meta.glob<string>('./assets/audio/typing/*.mp3', {
  eager: true,
  import: 'default',
  query: '?url',
});

function getTypingSoundUrl(slot: TypingSoundSlot): string | undefined {
  return TYPING_SOUND_URLS[`./assets/audio/typing/${slot}.mp3`];
}

class CatAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private idlePurrEnabled = false;
  private typingSoundEnabled = false;
  private masterVolume = 1.0;
  private muted = false;
  private graphReady = false;
  private outputGain: GainNode | null = null;
  private purrGain: GainNode | null = null;
  private purrFilter: BiquadFilterNode | null = null;
  private purrSource: AudioBufferSourceNode | null = null;
  private purrBuffer: AudioBuffer | null = null;
  private purrFallbackBuffer: AudioBuffer | null = null;
  private purrDecodePromise: Promise<void> | null = null;
  private purrDecodeFailedCtx: AudioContext | null = null;
  private tailYowlBuffer: AudioBuffer | null = null;
  private tailYowlDecodePromise: Promise<void> | null = null;
  private tailYowlDecodeFailedCtx: AudioContext | null = null;
  private tailYowlDecodeRetryAfterMs = 0;
  private tailYowlSource: AudioBufferSourceNode | null = null;
  private tailYowlGain: GainNode | null = null;
  private yowlBuffer: AudioBuffer | null = null;
  private shortYowlBuffer: AudioBuffer | null = null;
  private yowlDecodePromise: Promise<void> | null = null;
  private yowlDecodeFailedCtx: AudioContext | null = null;
  private yowlSource: AudioBufferSourceNode | null = null;
  private yowlGain: GainNode | null = null;
  private yowlRequest = 0;
  private purrStopTimer: number | null = null;
  private currentIntensity = 0;
  private currentPurrTone: 'normal' | 'chin' | 'knead' = 'normal';
  private deviceWatcherAttached = false;
  private visibilityWatcherAttached = false;
  private pendingRebuildOnActivity = false;
  private lastHealthRealMs = 0;
  private lastHealthCtxTime = 0;
  private suspendedSinceMs = 0;
  private lastForcedRebuildMs = 0;
  private rebuildTimer: number | null = null;
  private idleCloseTimer: number | null = null;
  private typingBuffers: Map<TypingSoundSlot, AudioBuffer> | null = null;
  private typingDecodePromise: Promise<void> | null = null;
  private typingDecodeFailedCtx: AudioContext | null = null;
  private typingDecodeRetryAfterMs = 0;
  private keyDownIndex = 0;
  private keyUpIndex = 0;
  private spaceIndex = 0;

  private getEffectiveVolume(): number {
    return this.muted ? 0 : this.masterVolume;
  }

  private isEffectivelyMuted(): boolean {
    return this.muted || this.masterVolume <= 0.001;
  }

  private syncOutputGain(): void {
    const out = this.outputGain;
    const ctx = this.ctx;
    if (!out || !ctx || (ctx.state as string) === 'closed') return;
    const target = this.getEffectiveVolume();
    try {
      const now = ctx.currentTime;
      if (Number.isFinite(now)) {
        out.gain.setTargetAtTime(target, now, 0.015);
      } else {
        out.gain.value = target;
      }
    } catch {
      try {
        out.gain.value = target;
      } catch {
        // ignore
      }
    }
  }

  private getMasterOutput(ctx: AudioContext): AudioNode {
    if (!this.outputGain) {
      const g = ctx.createGain();
      g.gain.value = this.getEffectiveVolume();
      g.connect(ctx.destination);
      this.outputGain = g;
    }
    return this.outputGain;
  }

  public setMasterVolume(volume: number): void {
    const normalized =
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.max(0, Math.min(1, volume >= 10 && volume <= 100 ? volume / 100 : volume))
        : 1.0;
    const wasMuted = this.isEffectivelyMuted();
    this.masterVolume = normalized;
    this.syncOutputGain();
    if (this.isEffectivelyMuted()) {
      this.setPurrIntensity(0);
      this.stopTailPokeYowl();
      this.stopHandoverYowl();
    } else if (wasMuted && this.typingSoundEnabled && !this.typingBuffers && !this.typingDecodePromise) {
      this.prewarmTypingBuffers();
    }
  }

  public setMuted(muted: boolean): void {
    const next = Boolean(muted);
    const wasMuted = this.isEffectivelyMuted();
    this.muted = next;
    this.syncOutputGain();
    if (this.isEffectivelyMuted()) {
      this.setPurrIntensity(0);
      this.stopTailPokeYowl();
      this.stopHandoverYowl();
    } else if (wasMuted && this.typingSoundEnabled && !this.typingBuffers && !this.typingDecodePromise) {
      this.prewarmTypingBuffers();
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      if (this.currentPurrTone !== 'knead') {
        this.setPurrIntensity(0);
      }
      this.stopTailPokeYowl();
      this.stopHandoverYowl();
    }
  }

  public setIdlePurrEnabled(enabled: boolean): void {
    this.idlePurrEnabled = Boolean(enabled);
    if (!this.idlePurrEnabled && this.currentPurrTone === 'knead' && this.currentIntensity > 0.01) {
      this.setPurrIntensity(0, 'knead');
    }
  }

  public setTypingSoundEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.typingSoundEnabled === next) {
      if (next && !this.typingBuffers && !this.typingDecodePromise) {
        this.prewarmTypingBuffers();
      }
      return;
    }
    this.typingSoundEnabled = next;
    if (next) {
      this.prewarmTypingBuffers();
    } else {
      this.typingBuffers = null;
      this.typingDecodePromise = null;
      this.typingDecodeFailedCtx = null;
    }
  }

  /**
   * Output device changes (headphones plugged in / Bluetooth headset connecting / monitor sleep
   * dropping HDMI/DP audio) can leave the WebView2 WASAPI stream silent even while `ctx.state`
   * still reports `running` (with a frozen `currentTime`) or stuck `suspended`. Rebuilding on
   * fresh activity or wake brings audio back reliably without restarting KuroCat (#119).
   */
  private attachDeviceWatcher(): void {
    if (!this.deviceWatcherAttached) {
      try {
        const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
        if (media && typeof media.addEventListener === 'function') {
          media.addEventListener('devicechange', () => this.scheduleRebuild());
          this.deviceWatcherAttached = true;
        }
      } catch {
        // Restricted WebView environments may deny navigator.mediaDevices access
      }
    }
    if (!this.visibilityWatcherAttached && typeof document !== 'undefined') {
      this.visibilityWatcherAttached = true;
      const onWake = () => {
        if (document.hidden) return;
        this.typingDecodeFailedCtx = null;
        this.typingDecodeRetryAfterMs = 0;
        if (this.pendingRebuildOnActivity) {
          this.scheduleRebuild();
        } else if (this.ctx) {
          this.checkContextHealth(this.ctx);
        }
      };
      document.addEventListener('visibilitychange', onWake);
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', onWake);
      }
    }
  }

  /** Called when the OS resumes from display sleep or system suspend to recover audio cleanly. */
  public onSystemResume(): void {
    if (this.isEffectivelyMuted() || (!this.enabled && !this.idlePurrEnabled && !this.typingSoundEnabled)) return;
    this.typingDecodeFailedCtx = null;
    this.typingDecodeRetryAfterMs = 0;
    this.purrDecodeFailedCtx = null;
    this.tailYowlDecodeFailedCtx = null;
    this.yowlDecodeFailedCtx = null;
    if (this.ctx) {
      this.scheduleRebuild();
    }
  }

  private scheduleRebuild(): void {
    if (typeof window === 'undefined') return;
    // Defer rebuild while the display/page is hidden (e.g. monitor off removing HDMI/DP audio),
    // otherwise we'd rebuild against a missing output device and poison buffer decoding (#119).
    if (typeof document !== 'undefined' && document.hidden) {
      this.pendingRebuildOnActivity = true;
      return;
    }
    this.pendingRebuildOnActivity = false;
    // Bluetooth headsets fire several devicechange events while the profile settles (A2DP/HFP),
    // so coalesce them into a single rebuild.
    if (this.rebuildTimer !== null) return;
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      if (typeof document !== 'undefined' && document.hidden) {
        this.pendingRebuildOnActivity = true;
        return;
      }
      this.rebuild();
    }, 280);
  }

  private checkContextHealth(ctx: AudioContext): boolean {
    if (typeof document !== 'undefined' && document.hidden) return false;
    const realNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.pendingRebuildOnActivity) {
      this.pendingRebuildOnActivity = false;
      this.lastForcedRebuildMs = realNow;
      this.rebuild();
      return true;
    }

    const state = ctx.state as string;
    if (state === 'closed' || state === 'interrupted') {
      if (realNow - this.lastForcedRebuildMs >= 1500) {
        this.lastForcedRebuildMs = realNow;
        this.rebuild();
        return true;
      }
      return false;
    }

    if (state === 'suspended') {
      if (this.suspendedSinceMs === 0) {
        this.suspendedSinceMs = realNow;
      } else if (realNow - this.suspendedSinceMs >= 650 && realNow - this.lastForcedRebuildMs >= 2000) {
        this.suspendedSinceMs = 0;
        this.lastForcedRebuildMs = realNow;
        this.rebuild();
        return true;
      }
      return false;
    }

    this.suspendedSinceMs = 0;
    const ctxTime = ctx.currentTime;
    if (!Number.isFinite(ctxTime)) {
      if (realNow - this.lastForcedRebuildMs >= 1500) {
        this.lastForcedRebuildMs = realNow;
        this.rebuild();
        return true;
      }
      return false;
    }

    if (this.lastHealthRealMs === 0) {
      this.lastHealthRealMs = realNow;
      this.lastHealthCtxTime = ctxTime;
      return false;
    }

    const realDelta = realNow - this.lastHealthRealMs;
    const ctxDelta = ctxTime - this.lastHealthCtxTime;
    if (realDelta >= 700) {
      // Detect frozen WebView2 WASAPI stream after display sleep (state === 'running', currentTime stuck)
      if (ctxDelta < 0.005 && realNow - this.lastForcedRebuildMs >= 2000) {
        this.lastForcedRebuildMs = realNow;
        this.rebuild();
        return true;
      }
      this.lastHealthRealMs = realNow;
      this.lastHealthCtxTime = ctxTime;
    }
    return false;
  }

  private safeResume(ctx: AudioContext): void {
    if (ctx.state !== 'suspended') return;
    try {
      const res = ctx.resume();
      if (res && typeof res.catch === 'function') {
        void res.catch(() => {});
      }
    } catch {
      // Autoplay policy or unavailable audio hardware on macOS WKWebView / Linux WebKitGTK
    }
  }

  private clearIdleCloseTimer(): void {
    if (this.idleCloseTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.idleCloseTimer);
    }
    this.idleCloseTimer = null;
  }

  private touchAudioActivity(): void {
    if (typeof window === 'undefined') return;
    this.clearIdleCloseTimer();
    // Reclaim Chromium's ~8 MB AudioService helper process after complete audio silence
    const delayMs = this.typingSoundEnabled ? 90_000 : 30_000;
    this.idleCloseTimer = window.setTimeout(() => {
      this.idleCloseTimer = null;
      if (!this.ctx) return;
      if (this.currentIntensity > 0.01 || this.purrSource || this.tailYowlSource || this.yowlSource) {
        this.touchAudioActivity();
        return;
      }
      this.teardownGraph();
    }, delayMs);
  }

  private clearPurrStopTimer(): void {
    if (this.purrStopTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.purrStopTimer);
    }
    this.purrStopTimer = null;
  }

  private stopPurrSource(): void {
    this.clearPurrStopTimer();
    const src = this.purrSource;
    this.purrSource = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      // already stopped
    }
    try {
      src.disconnect();
    } catch {
      // already disconnected
    }
  }

  private teardownGraph(): void {
    const ctx = this.ctx;
    this.clearIdleCloseTimer();
    this.stopPurrSource();
    if (this.purrFilter) {
      try {
        this.purrFilter.disconnect();
      } catch {
        // already disconnected
      }
    }
    if (this.purrGain) {
      try {
        this.purrGain.disconnect();
      } catch {
        // already disconnected
      }
    }
    if (this.outputGain) {
      try {
        this.outputGain.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.purrGain = null;
    this.outputGain = null;
    this.purrFilter = null;
    this.purrBuffer = null;
    this.purrFallbackBuffer = null;
    this.purrDecodePromise = null;
    this.purrDecodeFailedCtx = null;
    this.stopTailPokeYowl();
    this.tailYowlBuffer = null;
    this.tailYowlDecodePromise = null;
    this.tailYowlDecodeFailedCtx = null;
    this.stopHandoverYowl();
    this.yowlBuffer = null;
    this.shortYowlBuffer = null;
    this.yowlDecodePromise = null;
    this.yowlDecodeFailedCtx = null;
    this.graphReady = false;
    this.typingBuffers = null;
    this.typingDecodePromise = null;
    this.typingDecodeFailedCtx = null;
    this.typingDecodeRetryAfterMs = 0;
    this.lastHealthRealMs = 0;
    this.lastHealthCtxTime = 0;
    this.suspendedSinceMs = 0;
    this.ctx = null;
    if (ctx) {
      try {
        ctx.onstatechange = null;
        const p = ctx.close();
        if (p && typeof p.catch === 'function') {
          void p.catch(() => {});
        }
      } catch {
        // already closed or invalid context
      }
    }
  }

  private rebuild(): void {
    if (!this.ctx) return;
    // Keep the level the user is petting at, so a mid-stroke device switch does not stutter the purr
    const tone = this.currentPurrTone;
    const toneAllowed = tone === 'knead' ? this.idlePurrEnabled : this.enabled;
    const keepIntensity = toneAllowed && !this.isEffectivelyMuted() ? this.currentIntensity : 0;
    this.teardownGraph();
    if (keepIntensity > 0.01 && this.ensurePurrGraph() && this.ctx && this.purrGain) {
      try {
        this.startPurrLoopIfNeeded(this.ctx, true);
        this.applyPurrParams(this.ctx, keepIntensity, tone, 0.05);
      } catch {
        // Ignore scheduling errors if audio device vanished again mid-rebuild
      }
    }
    if (this.typingSoundEnabled && !this.isEffectivelyMuted()) {
      this.prewarmTypingBuffers();
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (
      this.isEffectivelyMuted() ||
      (!this.enabled && !this.idlePurrEnabled && !this.typingSoundEnabled) ||
      typeof window === 'undefined'
    ) {
      return null;
    }
    if (this.ctx) {
      this.checkContextHealth(this.ctx);
    }
    if (this.ctx && (this.ctx.state as string) === 'closed') {
      this.teardownGraph();
    }
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch {
        this.ctx = null;
        return null;
      }
      // Hard interruptions (device removed under us, OS audio reset) leave the context dead:
      // rebuild instead of staying silent until the next restart.
      const watched = this.ctx;
      watched.onstatechange = () => {
        if (this.ctx !== watched) return;
        const state = watched.state as string;
        if (state === 'closed' || state === 'interrupted') this.scheduleRebuild();
      };
      this.attachDeviceWatcher();
    }
    const ctx = this.ctx;
    if ((ctx.state as string) === 'closed') return null;
    if (!Number.isFinite(ctx.sampleRate) || ctx.sampleRate <= 0) {
      this.teardownGraph();
      return null;
    }
    this.safeResume(ctx);
    this.touchAudioActivity();
    return ctx;
  }

  /**
   * Trims cross-platform MP3 encoder priming/padding on decoded PCM and applies an
   * equal-power cosine/sine crossfade so `AudioBufferSourceNode.loop = true` is 100% seamless
   * across Windows WebView2, macOS WKWebView, and Linux WebKitGTK.
   */
  private static buildSeamlessPurrBuffer(ctx: AudioContext, decoded: AudioBuffer): AudioBuffer {
    const sr = decoded.sampleRate;
    const raw = decoded.getChannelData(0);
    const trim = Math.min(Math.floor(sr * 0.12), Math.floor(raw.length * 0.08));
    const usableLen = Math.max(1024, raw.length - trim * 2);
    const xfade = Math.min(Math.floor(sr * 0.55), Math.floor(usableLen * 0.22));
    const loopLen = Math.max(512, usableLen - xfade);

    const outBuf = ctx.createBuffer(1, loopLen, sr);
    const out = outBuf.getChannelData(0);
    for (let i = 0; i < loopLen; i++) {
      out[i] = raw[trim + i];
    }
    for (let i = 0; i < xfade; i++) {
      const angle = (i / xfade) * Math.PI * 0.5;
      const head = out[i];
      const tail = raw[trim + loopLen + i];
      out[i] = head * Math.sin(angle) + tail * Math.cos(angle);
    }
    return outBuf;
  }

  /**
   * Lightweight dual-phase glottal-pulse fallback buffer (~3.7 s seamless loop) used only for the
   * first ~15 ms while the real CC0 cat purr MP3 decodes asynchronously, or on restricted backends.
   */
  private static buildGlottalFallbackBuffer(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const cycleDur = 1.85;
    const totalDur = cycleDur * 2;
    const len = Math.max(2048, Math.floor(sr * totalDur));
    const tmp = new Float32Array(len);

    let phase = 0;
    let lp1 = 0;
    let lp2 = 0;
    let lp3 = 0;
    let hp = 0;
    let prevIn = 0;
    let jitter = 0;

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const cycPos = (t % cycleDur) / cycleDur;
      let env = 0.05;
      let isExhale = false;
      if (cycPos < 0.46) {
        env = Math.pow(Math.sin((cycPos / 0.46) * Math.PI), 0.65) * 0.86;
      } else if (cycPos >= 0.52 && cycPos < 0.95) {
        isExhale = true;
        env = Math.pow(Math.sin(((cycPos - 0.52) / 0.43) * Math.PI), 0.58);
      }
      jitter = jitter * 0.9992 + (Math.random() * 2 - 1) * 0.045;
      phase += ((isExhale ? 27.6 : 25.2) + jitter * 1.4) / sr;
      if (phase >= 1) phase -= 1;

      let glottal = 0;
      if (phase < 0.38) {
        glottal = 0.5 * (1 - Math.cos(Math.PI * (phase / 0.38)));
      } else if (phase < 0.54) {
        glottal = Math.cos(0.5 * Math.PI * ((phase - 0.38) / 0.16));
      }
      const click = phase > 0.48 && phase < 0.62 ? Math.sin(((phase - 0.48) / 0.14) * Math.PI) * 0.30 : 0;
      const air = (Math.random() * 2 - 1) * (0.07 + 0.14 * glottal) * (isExhale ? 1.15 : 0.85);
      const raw = ((glottal - 0.28) * 1.15 + click + air) * env;

      lp1 += (raw - lp1) * 0.065;
      lp2 += (lp1 - lp2) * 0.11;
      lp3 += (raw - lp3) * 0.24;
      const shaped = lp2 * 1.55 + (lp3 - lp2) * 0.48;
      hp = 0.996 * (hp + shaped - prevIn);
      prevIn = shaped;
      tmp[i] = hp;
    }

    const xf = Math.min(Math.floor(sr * 0.35), Math.floor(len * 0.2));
    const loopLen = len - xf;
    const outBuf = ctx.createBuffer(1, loopLen, sr);
    const out = outBuf.getChannelData(0);
    let sumSq = 0;
    for (let i = 0; i < loopLen; i++) {
      let s = tmp[i];
      if (i < xf) {
        const a = (i / xf) * Math.PI * 0.5;
        s = s * Math.sin(a) + tmp[loopLen + i] * Math.cos(a);
      }
      out[i] = s;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / loopLen + 1e-12);
    const gain = 0.14 / rms;
    for (let i = 0; i < loopLen; i++) {
      out[i] = Math.max(-0.92, Math.min(0.92, out[i] * gain));
    }
    return outBuf;
  }

  private prewarmPurrBuffer(ctx: AudioContext): void {
    if (this.purrBuffer || this.purrDecodePromise || this.purrDecodeFailedCtx === ctx) return;
    const targetCtx = ctx;
    const task = (async () => {
      try {
        const ab = await CatAudio.fetchAudioArrayBuffer(purrMp3Url);
        const decoded = await CatAudio.decodeAudioBuffer(targetCtx, ab);
        if (this.ctx !== targetCtx) return;
        this.purrBuffer = CatAudio.buildSeamlessPurrBuffer(targetCtx, decoded);
        // If user is currently petting on the temporary fallback buffer, smoothly swap to real cat audio
        const toneAllowed = this.currentPurrTone === 'knead' ? this.idlePurrEnabled : this.enabled;
        if (toneAllowed && !this.isEffectivelyMuted() && this.currentIntensity > 0.01 && this.graphReady && this.purrFilter) {
          this.stopPurrSource();
          this.startPurrLoopIfNeeded(targetCtx, true);
          this.applyPurrParams(targetCtx, this.currentIntensity, this.currentPurrTone, 0.08);
        }
      } catch {
        if (this.ctx === targetCtx) {
          this.purrDecodeFailedCtx = targetCtx;
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (this.purrDecodePromise === task) {
          this.purrDecodePromise = null;
        }
      });
    this.purrDecodePromise = task;
  }

  private startPurrLoopIfNeeded(ctx: AudioContext, randomOffset: boolean): void {
    this.clearPurrStopTimer();
    if (this.purrSource || !this.purrFilter) return;
    const buf =
      this.purrBuffer ??
      (this.purrFallbackBuffer ??= CatAudio.buildGlottalFallbackBuffer(ctx));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const rate =
      this.currentPurrTone === 'chin' ? 0.94 : this.currentPurrTone === 'knead' ? 0.98 : 1.0;
    src.playbackRate.value = rate;
    src.connect(this.purrFilter);
    const offset =
      randomOffset && buf.duration > 0.25 ? Math.random() * (buf.duration - 0.15) : 0;
    src.start(0, offset);
    this.purrSource = src;
  }

  private applyPurrParams(
    ctx: AudioContext,
    intensity: number,
    tone: 'normal' | 'chin' | 'knead',
    timeConst: number,
  ): void {
    if (!this.purrGain) return;
    const now = ctx.currentTime;
    if (!Number.isFinite(now)) return;
    const gainScale = tone === 'chin' ? 0.54 : tone === 'knead' ? 0.28 : 0.44;
    const targetGain = intensity > 0.01 ? intensity * gainScale : 0.0001;
    this.purrGain.gain.setTargetAtTime(targetGain, now, timeConst);
    if (this.purrFilter) {
      const lpFreq = tone === 'chin' ? 2600 : tone === 'knead' ? 1900 : 3400;
      this.purrFilter.frequency.setTargetAtTime(lpFreq, now, 0.12);
    }
    if (this.purrSource) {
      const rate = tone === 'chin' ? 0.94 : tone === 'knead' ? 0.98 : 1.0;
      this.purrSource.playbackRate.setTargetAtTime(rate, now, 0.12);
    }
  }

  private ensurePurrGraph(): boolean {
    if ((!this.enabled && !this.idlePurrEnabled) || this.isEffectivelyMuted() || typeof window === 'undefined') return false;
    const ctx = this.ensureAudioContext();
    if (!ctx) return false;
    if (this.graphReady) return (ctx.state as string) !== 'closed';

    try {
      const purrFilter = ctx.createBiquadFilter();
      purrFilter.type = 'lowpass';
      purrFilter.frequency.value = 3400;
      purrFilter.Q.value = 0.7;

      const purrGain = ctx.createGain();
      purrGain.gain.value = 0.0001;

      purrFilter.connect(purrGain);
      purrGain.connect(this.getMasterOutput(ctx));

      this.purrFilter = purrFilter;
      this.purrGain = purrGain;
      this.graphReady = true;
      this.prewarmPurrBuffer(ctx);

      return true;
    } catch {
      this.teardownGraph();
      return false;
    }
  }

  private getReadyContext(): AudioContext | null {
    if (!this.enabled || this.isEffectivelyMuted()) return null;
    if (!this.ensurePurrGraph() || !this.ctx) return null;
    const ctx = this.ctx;
    if ((ctx.state as string) === 'closed') return null;
    if (!Number.isFinite(ctx.currentTime) || !Number.isFinite(ctx.sampleRate) || ctx.sampleRate <= 0) {
      return null;
    }
    this.safeResume(ctx);
    this.touchAudioActivity();
    return ctx;
  }

  private getTypingContext(): AudioContext | null {
    if (!this.typingSoundEnabled || this.isEffectivelyMuted()) return null;
    const ctx = this.ensureAudioContext();
    if (!ctx) return null;
    if (!Number.isFinite(ctx.currentTime)) return null;
    return ctx;
  }

  private static async fetchAudioArrayBuffer(url: string): Promise<ArrayBuffer> {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Audio fetch failed (${resp.status})`);
    }
    return resp.arrayBuffer();
  }

  private static trimLeadingSilence(ctx: AudioContext, decoded: AudioBuffer, maxSkipSec = 0.06): AudioBuffer {
    const sr = decoded.sampleRate;
    const raw = decoded.getChannelData(0);
    const maxSkip = Math.min(raw.length - 64, Math.floor(sr * maxSkipSec));
    let start = 0;
    while (start < maxSkip && Math.abs(raw[start]) < 0.008) {
      start++;
    }
    start = Math.max(0, start - 2);
    if (start <= 4 || raw.length - start < 64) {
      return decoded;
    }
    const len = raw.length - start;
    const out = ctx.createBuffer(1, len, sr);
    out.getChannelData(0).set(raw.subarray(start));
    return out;
  }

  private static decodeAudioBuffer(ctx: AudioContext, ab: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
      try {
        const maybePromise = ctx.decodeAudioData(
          ab,
          (decoded) => resolve(decoded),
          (err) => reject(err ?? new Error('decodeAudioData failed')),
        );
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  private prewarmTypingBuffers(): void {
    if (!this.typingSoundEnabled) return;
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      this.typingBuffers ||
      this.typingDecodePromise ||
      (this.typingDecodeFailedCtx === ctx && nowMs < this.typingDecodeRetryAfterMs)
    ) {
      return;
    }

    const targetCtx = ctx;
    const decodeTask = (async () => {
      const decodedMap = new Map<TypingSoundSlot, AudioBuffer>();
      await Promise.all(
        ALL_TYPING_SLOTS.map(async (slot) => {
          if (this.ctx !== targetCtx || !this.typingSoundEnabled) return;
          try {
            const url = getTypingSoundUrl(slot);
            if (!url) return;
            const ab = await CatAudio.fetchAudioArrayBuffer(url);
            const decoded = await CatAudio.decodeAudioBuffer(targetCtx, ab);
            if (this.ctx === targetCtx && this.typingSoundEnabled) {
              decodedMap.set(slot, CatAudio.trimLeadingSilence(targetCtx, decoded));
            }
          } catch {
            // Ignore per-slot decode failure on restricted WebView backends
          }
        }),
      );
      if (this.ctx === targetCtx && this.typingSoundEnabled) {
        if (decodedMap.size > 0) {
          this.typingBuffers = decodedMap;
          this.typingDecodeFailedCtx = null;
          this.typingDecodeRetryAfterMs = 0;
        } else if (typeof document === 'undefined' || !document.hidden) {
          // Back off briefly instead of permanently poisoning this AudioContext (#119)
          this.typingDecodeFailedCtx = targetCtx;
          this.typingDecodeRetryAfterMs =
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 5000;
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (this.typingDecodePromise === decodeTask) {
          this.typingDecodePromise = null;
        }
      });

    this.typingDecodePromise = decodeTask;
  }

  private randRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private playTypingSlot(slot: TypingSoundSlot, gain: number, playbackRate: number, pan: number): void {
    if (!this.typingSoundEnabled) return;
    try {
      const ctx = this.getTypingContext();
      if (!ctx) return;
      if (!this.typingBuffers) {
        this.prewarmTypingBuffers();
        return;
      }
      const buf = this.typingBuffers.get(slot);
      if (!buf) return;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = playbackRate;

      const gainNode = ctx.createGain();
      gainNode.gain.value = gain;

      let panNode: StereoPannerNode | null = null;
      const clampedPan = Number.isFinite(pan) ? Math.max(-0.38, Math.min(0.38, pan)) : 0;
      if (Math.abs(clampedPan) > 0.001 && typeof ctx.createStereoPanner === 'function') {
        try {
          panNode = ctx.createStereoPanner();
          panNode.pan.value = clampedPan;
        } catch {
          panNode = null;
        }
      }

      const out = this.getMasterOutput(ctx);
      src.connect(gainNode);
      if (panNode) {
        gainNode.connect(panNode);
        panNode.connect(out);
      } else {
        gainNode.connect(out);
      }

      src.onended = () => {
        try {
          src.disconnect();
          gainNode.disconnect();
          panNode?.disconnect();
        } catch {
          // ignore
        }
      };

      src.start();
    } catch {
      // Never throw on macOS WKWebView / Linux WebKitGTK / missing audio hardware
    }
  }

  public playKeyDown(vk: number, pan = 0): void {
    if (!this.typingSoundEnabled || this.isEffectivelyMuted()) return;
    try {
      let slot: TypingSoundSlot;
      if (vk === 0x20) {
        slot = this.spaceIndex++ % 2 === 0 ? 'space0' : 'space1';
      } else if (vk === 0x0d || vk === 0x10d) {
        slot = 'enter';
      } else if (vk === 0x08) {
        slot = 'backspace';
      } else {
        slot = KEY_DOWN_SLOTS[this.keyDownIndex++ % KEY_DOWN_SLOTS.length];
      }
      const gain = 0.58 * this.randRange(0.93, 1.05);
      const rate = this.randRange(0.985, 1.015);
      this.playTypingSlot(slot, gain, rate, pan);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  public playKeyUp(vk: number, pan = 0): void {
    if (!this.typingSoundEnabled || this.isEffectivelyMuted()) return;
    try {
      let slot: TypingSoundSlot;
      if (vk === 0x20) {
        slot = 'space_up';
      } else if (vk === 0x0d || vk === 0x10d) {
        slot = 'enter_up';
      } else {
        slot = KEY_UP_SLOTS[this.keyUpIndex++ % KEY_UP_SLOTS.length];
      }
      const gain = 0.52 * this.randRange(0.93, 1.05);
      const rate = this.randRange(0.985, 1.015);
      this.playTypingSlot(slot, gain, rate, pan);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  public playMouseDown(button: string): void {
    if (!this.typingSoundEnabled || this.isEffectivelyMuted()) return;
    try {
      const isAlt = button === 'right' || button === 'middle';
      const slot: TypingSoundSlot = isAlt ? 'mouse_down1' : 'mouse_down0';
      const rate = isAlt ? this.randRange(0.96, 0.99) : this.randRange(0.985, 1.015);
      const gain = 0.44 * this.randRange(0.94, 1.04);
      this.playTypingSlot(slot, gain, rate, 0.24);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  public playMouseUp(_button: string): void {
    if (!this.typingSoundEnabled || this.isEffectivelyMuted()) return;
    try {
      const rate = this.randRange(0.985, 1.015);
      const gain = 0.48 * this.randRange(0.94, 1.04);
      this.playTypingSlot('mouse_up0', gain, rate, 0.24);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Smoothly drives real domestic cat purring (0 = silent, 1 = full cozy purr).
   * `tone`: 'normal' (head pet), 'chin' (deeper warm chest purr), 'knead' (gentle soft purr).
   */
  public setPurrIntensity(intensity: number, tone: 'normal' | 'chin' | 'knead' = 'normal'): void {
    const toneAllowed = tone === 'knead' ? this.idlePurrEnabled : this.enabled;
    const target = toneAllowed && !this.isEffectivelyMuted() ? Math.max(0, Math.min(1, intensity)) : 0;
    if (target <= 0.01 && !this.graphReady) return;
    if (Math.abs(target - this.currentIntensity) < 0.005 && tone === this.currentPurrTone) return;
    const wasSilent = this.currentIntensity <= 0.01;
    this.currentIntensity = target;
    this.currentPurrTone = tone;

    if (target > 0.01 && !this.ensurePurrGraph()) return;
    if (!this.ctx || !this.purrGain || (this.ctx.state as string) === 'closed') return;

    if (target > 0.01) {
      this.safeResume(this.ctx);
      this.prewarmPurrBuffer(this.ctx);
    }

    try {
      if (target > 0.01) {
        this.startPurrLoopIfNeeded(this.ctx, wasSilent);
        this.applyPurrParams(this.ctx, target, tone, 0.14);
      } else {
        this.applyPurrParams(this.ctx, 0, tone, 0.22);
        this.clearPurrStopTimer();
        if (typeof window !== 'undefined' && this.purrSource) {
          this.purrStopTimer = window.setTimeout(() => {
            this.purrStopTimer = null;
            if (this.currentIntensity <= 0.01) {
              this.stopPurrSource();
            }
          }, 950);
        }
      }
    } catch {
      // Ignore AudioParam errors on suspended/closed WebView audio backends
    }
  }

  /**
   * Cute soft nose-boop squeak + tiny kitten sneeze puff!
   */
  public playBoopSneeze(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.008;

      // 1) Tiny soft rubbery "boop" tone
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.exponentialRampToValueAtTime(780, t0 + 0.045);
      osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.11);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.075, t0 + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      const out = this.getMasterOutput(ctx);
      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.14);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };

      // 2) Delayed tiny kitten "pff-chu!" filtered air puff (~0.30s later)
      const sneezeT = t0 + 0.30;
      const bufLen = Math.max(1, Math.floor(ctx.sampleRate * 0.14));
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.45));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400, sneezeT);
      bp.frequency.exponentialRampToValueAtTime(1100, sneezeT + 0.11);
      bp.Q.value = 1.4;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, sneezeT);
      ng.gain.linearRampToValueAtTime(0.085, sneezeT + 0.015);
      ng.gain.exponentialRampToValueAtTime(0.0001, sneezeT + 0.12);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      src.start(sneezeT);
      src.stop(sneezeT + 0.14);
      src.onended = () => {
        try {
          src.disconnect();
          bp.disconnect();
          ng.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  private prewarmTailPokeYowlBuffer(ctx: AudioContext): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      this.tailYowlBuffer ||
      this.tailYowlDecodePromise ||
      (this.tailYowlDecodeFailedCtx === ctx && nowMs < this.tailYowlDecodeRetryAfterMs)
    ) {
      return;
    }
    const targetCtx = ctx;
    const task = (async () => {
      try {
        const ab = await CatAudio.fetchAudioArrayBuffer(tailPokeYowlMp3Url);
        const decoded = await CatAudio.decodeAudioBuffer(targetCtx, ab);
        if (this.ctx !== targetCtx) return;
        this.tailYowlBuffer = CatAudio.trimLeadingSilence(targetCtx, decoded, 0.12);
        this.tailYowlDecodeFailedCtx = null;
        this.tailYowlDecodeRetryAfterMs = 0;
      } catch {
        if (this.ctx === targetCtx) {
          this.tailYowlDecodeFailedCtx = targetCtx;
          this.tailYowlDecodeRetryAfterMs =
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 5000;
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (this.tailYowlDecodePromise === task) {
          this.tailYowlDecodePromise = null;
        }
      });
    this.tailYowlDecodePromise = task;
  }

  public stopTailPokeYowl(): void {
    const src = this.tailYowlSource;
    const gain = this.tailYowlGain;
    this.tailYowlSource = null;
    this.tailYowlGain = null;
    if (src) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch {
        // ignore
      }
    }
  }

  private playDecodedTailYowlBuffer(ctx: AudioContext, buf: AudioBuffer, onStart?: () => void): void {
    const startNow = () => {
      if (this.ctx !== ctx || !this.enabled || this.isEffectivelyMuted()) return;
      this.stopTailPokeYowl();
      const t0 = ctx.currentTime + 0.008;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.48, t0 + 0.015);
      gain.gain.setValueAtTime(0.48, t0 + Math.max(0.04, buf.duration - 0.08));
      gain.gain.linearRampToValueAtTime(0.0001, t0 + buf.duration);
      src.connect(gain);
      gain.connect(this.getMasterOutput(ctx));
      this.tailYowlSource = src;
      this.tailYowlGain = gain;
      src.onended = () => {
        if (this.tailYowlSource === src) {
          this.tailYowlSource = null;
          this.tailYowlGain = null;
        }
        try {
          src.disconnect();
          gain.disconnect();
        } catch {
          // ignore
        }
      };
      src.start(t0);
      onStart?.();
    };

    if (ctx.state === 'suspended') {
      try {
        const res = ctx.resume();
        if (res && typeof res.then === 'function') {
          void res.then(startNow).catch(() => {});
          return;
        }
      } catch {
        // fall through
      }
    }
    startNow();
  }

  /**
   * Grumpy "老吴~" cat yowl when tail is poked (escalated = true), falling back to a quick
   * synthesized flick chirp if audio decoding is unavailable or non-escalated.
   */
  public playTailFlick(escalated = false, onYowlStart?: () => void): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      if (escalated) {
        if (this.tailYowlBuffer) {
          this.playDecodedTailYowlBuffer(ctx, this.tailYowlBuffer, onYowlStart);
          return;
        }
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (this.tailYowlDecodeFailedCtx !== ctx || nowMs >= this.tailYowlDecodeRetryAfterMs) {
          this.prewarmTailPokeYowlBuffer(ctx);
          const pending = this.tailYowlDecodePromise;
          if (pending) {
            void pending.then(() => {
              if (this.enabled && !this.isEffectivelyMuted() && this.ctx === ctx && this.tailYowlBuffer) {
                this.playDecodedTailYowlBuffer(ctx, this.tailYowlBuffer, onYowlStart);
              }
            });
            return;
          }
        }
      } else {
        // Prewarm the "老吴~" yowl buffer on poke #1/#2 so poke #3 fires with 0ms latency!
        this.prewarmTailPokeYowlBuffer(ctx);
      }

      const t0 = ctx.currentTime + 0.006;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = escalated ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(escalated ? 340 : 460, t0);
      osc.frequency.exponentialRampToValueAtTime(escalated ? 210 : 690, t0 + 0.085);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(escalated ? 0.09 : 0.06, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.105);
      osc.connect(g);
      g.connect(this.getMasterOutput(ctx));
      osc.start(t0);
      osc.stop(t0 + 0.12);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Soft mochi "boing" thump on scruff landing!
   */
  public playSoftLand(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.005;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(165, t0);
      osc.frequency.exponentialRampToValueAtTime(88, t0 + 0.095);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.08, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      osc.connect(g);
      g.connect(this.getMasterOutput(ctx));
      osc.start(t0);
      osc.stop(t0 + 0.125);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Cute playful wobbling vibrato chime when the cat gets shaken dizzy!
   */
  public playDizzy(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.008;
      const dur = 0.48;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const g = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(610, t0);
      osc.frequency.exponentialRampToValueAtTime(410, t0 + 0.16);
      osc.frequency.exponentialRampToValueAtTime(490, t0 + 0.28);
      osc.frequency.exponentialRampToValueAtTime(320, t0 + dur);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(12.5, t0);
      lfoGain.gain.setValueAtTime(34, t0);
      lfoGain.gain.exponentialRampToValueAtTime(14, t0 + dur);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.052, t0 + 0.035);
      g.gain.setValueAtTime(0.044, t0 + 0.26);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(g);
      g.connect(this.getMasterOutput(ctx));

      osc.start(t0);
      lfo.start(t0);
      osc.stop(t0 + dur + 0.02);
      lfo.stop(t0 + dur + 0.02);
      osc.onended = () => {
        try {
          lfo.disconnect();
          lfoGain.disconnect();
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Soft, cozy synthesized notification chime for AI Companion events (done / waiting / error).
   * Respects the global sound toggle and leaves zero persistent audio nodes behind.
   */
  public playAgentNotice(kind: 'done' | 'waiting' | 'error'): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    const notes: Array<{ freq: number; delay: number; dur: number; gain: number }> =
      kind === 'done'
        ? [
            { freq: 587.33, delay: 0.0, dur: 0.16, gain: 0.085 },
            { freq: 880.0, delay: 0.095, dur: 0.24, gain: 0.095 },
          ]
        : kind === 'waiting'
          ? [{ freq: 659.25, delay: 0.0, dur: 0.22, gain: 0.075 }]
          : [
              { freq: 311.13, delay: 0.0, dur: 0.14, gain: 0.075 },
              { freq: 246.94, delay: 0.11, dur: 0.20, gain: 0.075 },
            ];

    try {
      const out = this.getMasterOutput(ctx);
      const t0 = ctx.currentTime + 0.01;
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = kind === 'error' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(n.freq, t0 + n.delay);
        g.gain.setValueAtTime(0.0001, t0 + n.delay);
        g.gain.linearRampToValueAtTime(n.gain, t0 + n.delay + 0.018);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.delay + n.dur);
        osc.connect(g);
        g.connect(out);
        osc.start(t0 + n.delay);
        osc.stop(t0 + n.delay + n.dur + 0.02);
        osc.onended = () => {
          try {
            osc.disconnect();
            g.disconnect();
          } catch {
            // ignore
          }
        };
      }
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Soft wet kitty licking pulse for the "喂猫条" (Churu treat) interaction.
   * Layered gentle band-passed brush + warm slurp blip, routed through master volume.
   */
  public playTreatLick(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const out = this.getMasterOutput(ctx);
      const t0 = ctx.currentTime + 0.006;

      // 1) Gentle wet tongue-brush micro-burst (~65ms filtered noise)
      const dur = 0.072;
      const bufLen = Math.max(256, Math.floor(ctx.sampleRate * dur));
      const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        const u = i / bufLen;
        const env = Math.sin(u * Math.PI);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const jitter = 0.9 + Math.random() * 0.22;
      bp.frequency.setValueAtTime(1650 * jitter, t0);
      bp.frequency.exponentialRampToValueAtTime(980 * jitter, t0 + dur);
      bp.Q.setValueAtTime(2.6, t0);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(0.062, t0 + 0.018);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      noise.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      noise.start(t0);
      noise.stop(t0 + dur + 0.01);
      noise.onended = () => {
        try {
          noise.disconnect();
          bp.disconnect();
          ng.disconnect();
        } catch {
          // ignore
        }
      };

      // 2) Soft warm lip-smack / slurp harmonic
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340 * jitter, t0 + 0.01);
      osc.frequency.exponentialRampToValueAtTime(640 * jitter, t0 + 0.055);
      og.gain.setValueAtTime(0.0001, t0 + 0.01);
      og.gain.linearRampToValueAtTime(0.044, t0 + 0.024);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.068);
      osc.connect(og);
      og.connect(out);
      osc.start(t0 + 0.01);
      osc.stop(t0 + 0.075);
      osc.onended = () => {
        try {
          osc.disconnect();
          og.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Playful tiny impatient chirp + soft paw-bap when teased near the mouth without squeezing.
   */
  public playTreatSwat(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const out = this.getMasterOutput(ctx);
      const t0 = ctx.currentTime + 0.008;
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.exponentialRampToValueAtTime(790, t0 + 0.065);
      osc.frequency.exponentialRampToValueAtTime(460, t0 + 0.14);
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1900, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.068, t0 + 0.022);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.155);
      osc.connect(lp);
      lp.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.17);
      osc.onended = () => {
        try {
          osc.disconnect();
          lp.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  /**
   * Satisfied happy trill-meow + warm sparkle triad upon finishing a full Churu cat treat!
   */
  public playTreatFinish(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const out = this.getMasterOutput(ctx);
      const t0 = ctx.currentTime + 0.01;

      // Cute rising satisfied kitty trill ("mrrp~!")
      const voice = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      const vg = ctx.createGain();
      voice.type = 'triangle';
      voice.frequency.setValueAtTime(520, t0);
      voice.frequency.exponentialRampToValueAtTime(780, t0 + 0.14);
      voice.frequency.exponentialRampToValueAtTime(660, t0 + 0.30);
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(28, t0);
      lfoGain.gain.setValueAtTime(22, t0);
      lfo.connect(lfoGain);
      lfoGain.connect(voice.frequency);
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2100, t0);
      vg.gain.setValueAtTime(0.0001, t0);
      vg.gain.linearRampToValueAtTime(0.072, t0 + 0.035);
      vg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      voice.connect(lp);
      lp.connect(vg);
      vg.connect(out);
      voice.start(t0);
      lfo.start(t0);
      voice.stop(t0 + 0.34);
      lfo.stop(t0 + 0.34);
      voice.onended = () => {
        try {
          voice.disconnect();
          lfo.disconnect();
          lfoGain.disconnect();
          lp.disconnect();
          vg.disconnect();
        } catch {
          // ignore
        }
      };

      // Warm cozy celebratory sparkle triad (C5 -> E5 -> G5)
      const sparkleNotes = [
        { freq: 523.25, delay: 0.12, dur: 0.18, gain: 0.055 },
        { freq: 659.25, delay: 0.19, dur: 0.20, gain: 0.062 },
        { freq: 783.99, delay: 0.26, dur: 0.28, gain: 0.068 },
      ];
      for (const n of sparkleNotes) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, t0 + n.delay);
        g.gain.setValueAtTime(0.0001, t0 + n.delay);
        g.gain.linearRampToValueAtTime(n.gain, t0 + n.delay + 0.016);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.delay + n.dur);
        osc.connect(g);
        g.connect(out);
        osc.start(t0 + n.delay);
        osc.stop(t0 + n.delay + n.dur + 0.02);
        osc.onended = () => {
          try {
            osc.disconnect();
            g.disconnect();
          } catch {
            // ignore
          }
        };
      }
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  private scheduleHandoverCall(
    ctx: AudioContext,
    species: 'cat' | 'other',
    startAt: number,
    pitchScale: number,
    volume: number,
    pan: number,
  ): void {
    const masterOut = this.getMasterOutput(ctx);
    const outNode: AudioNode =
      typeof ctx.createStereoPanner === 'function'
        ? (() => {
            const p = ctx.createStereoPanner();
            p.pan.setValueAtTime(Math.max(-0.55, Math.min(0.55, pan)), startAt);
            p.connect(masterOut);
            return p;
          })()
        : masterOut;

    const releaseOut = () => {
      if (outNode !== masterOut) {
        try {
          outNode.disconnect();
        } catch {
          // ignore
        }
      }
    };

    if (species === 'other') {
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(490 * pitchScale, startAt);
      osc.frequency.exponentialRampToValueAtTime(860 * pitchScale, startAt + 0.12);
      osc.frequency.exponentialRampToValueAtTime(560 * pitchScale, startAt + 0.28);
      lfo.frequency.setValueAtTime(19, startAt);
      lfoG.gain.setValueAtTime(28, startAt);
      lfo.connect(lfoG);
      lfoG.connect(osc.frequency);
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.linearRampToValueAtTime(volume * 0.9, startAt + 0.024);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.30);
      osc.connect(g);
      g.connect(outNode);
      osc.start(startAt);
      lfo.start(startAt);
      osc.stop(startAt + 0.32);
      lfo.stop(startAt + 0.32);
      osc.onended = () => {
        try {
          osc.disconnect();
          lfo.disconnect();
          lfoG.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
        releaseOut();
      };
      return;
    }

    const playSyllable = (
      s0: number,
      dur: number,
      f0Start: number,
      f0Peak: number,
      f0End: number,
      f1Open: number,
      f1Round: number,
      f2Open: number,
      f2Round: number,
      vol: number,
      isLongGrowl = false,
    ) => {
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const f1 = ctx.createBiquadFilter();
      const f2 = ctx.createBiquadFilter();
      const f1Gain = ctx.createGain();
      const f2Gain = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();

      osc.type = 'sawtooth';
      sub.type = 'triangle';
      const p0 = f0Start * pitchScale;
      const p1 = f0Peak * pitchScale;
      const p2 = f0End * pitchScale;
      osc.frequency.setValueAtTime(p0, s0);
      osc.frequency.exponentialRampToValueAtTime(p1, s0 + dur * (isLongGrowl ? 0.18 : 0.38));
      osc.frequency.exponentialRampToValueAtTime(p2, s0 + dur);
      sub.frequency.setValueAtTime(p0 * 0.5, s0);
      sub.frequency.exponentialRampToValueAtTime(p1 * 0.5, s0 + dur * (isLongGrowl ? 0.18 : 0.38));
      sub.frequency.exponentialRampToValueAtTime(p2 * 0.5, s0 + dur);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(isLongGrowl ? 22 : 27, s0);
      lfoGain.gain.setValueAtTime((isLongGrowl ? 14 : 18) * pitchScale, s0);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      f1.type = 'bandpass';
      f1.Q.value = isLongGrowl ? 4.2 : 3.6;
      f1.frequency.setValueAtTime(f1Open * pitchScale, s0);
      f1.frequency.exponentialRampToValueAtTime(f1Round * pitchScale, s0 + dur * (isLongGrowl ? 0.55 : 0.78));

      f2.type = 'bandpass';
      f2.Q.value = isLongGrowl ? 4.8 : 4.2;
      f2.frequency.setValueAtTime(f2Open * pitchScale, s0);
      f2.frequency.exponentialRampToValueAtTime(f2Round * pitchScale, s0 + dur * (isLongGrowl ? 0.55 : 0.78));

      f1Gain.gain.value = 1.05;
      f2Gain.gain.value = 0.62;

      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2200, s0);
      lp.Q.value = 0.8;

      const subGain = ctx.createGain();
      subGain.gain.value = 0.24;

      g.gain.setValueAtTime(0.0001, s0);
      g.gain.linearRampToValueAtTime(vol, s0 + Math.min(0.035, dur * 0.22));
      g.gain.setValueAtTime(vol * 0.90, s0 + dur * 0.72);
      g.gain.exponentialRampToValueAtTime(0.0001, s0 + dur);

      osc.connect(f1);
      osc.connect(f2);
      sub.connect(subGain);
      subGain.connect(f1);
      f1.connect(f1Gain);
      f2.connect(f2Gain);
      f1Gain.connect(lp);
      f2Gain.connect(lp);
      lp.connect(g);
      g.connect(outNode);

      osc.start(s0);
      sub.start(s0);
      lfo.start(s0);
      osc.stop(s0 + dur + 0.03);
      sub.stop(s0 + dur + 0.03);
      lfo.stop(s0 + dur + 0.03);
      osc.onended = () => {
        try {
          osc.disconnect();
          sub.disconnect();
          subGain.disconnect();
          lfo.disconnect();
          lfoGain.disconnect();
          f1.disconnect();
          f2.disconnect();
          f1Gain.disconnect();
          f2Gain.disconnect();
          lp.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
        if (isLongGrowl) releaseOut();
      };
    };

    const warbleBeats: Array<[number, number, number, number, number]> = [
      [0.00, 0.22, 275, 345, 250],
      [0.23, 0.22, 285, 365, 255],
      [0.46, 0.23, 295, 375, 260],
      [0.70, 0.24, 305, 385, 265],
    ];
    for (const [off, d, f0, fp, fe] of warbleBeats) {
      playSyllable(startAt + off, d, f0, fp, fe, 820, 370, 1480, 740, volume, false);
    }
    playSyllable(startAt + 0.98, 0.82, 330, 355, 215, 560, 340, 1120, 680, volume * 1.12, true);
  }

  public prewarmHandoverYowl(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;
    this.prewarmHandoverYowlBuffer(ctx);
  }

  private prewarmHandoverYowlBuffer(ctx: AudioContext): void {
    if (this.yowlBuffer || this.yowlDecodePromise || this.yowlDecodeFailedCtx === ctx) return;
    const targetCtx = ctx;
    const task = (async () => {
      try {
        const ab = await CatAudio.fetchAudioArrayBuffer(handoverYowlMp3Url);
        const decoded = await CatAudio.decodeAudioBuffer(targetCtx, ab);
        if (this.ctx !== targetCtx) return;
        this.yowlBuffer = decoded;
      } catch {
        if (this.ctx === targetCtx) {
          this.yowlDecodeFailedCtx = targetCtx;
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (this.yowlDecodePromise === task) {
          this.yowlDecodePromise = null;
        }
      });
    this.yowlDecodePromise = task;
  }

  public stopHandoverYowl(): void {
    this.yowlRequest++;
    const src = this.yowlSource;
    const gain = this.yowlGain;
    this.yowlSource = null;
    this.yowlGain = null;
    if (src) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch {
        // ignore
      }
    }
  }

  // The short take uses the same recording. Join the two quiet troughs around
  // the repeated middle calls using source-sample positions at any device rate.
  private shortYowl(ctx: AudioContext, full: AudioBuffer): AudioBuffer {
    if (this.shortYowlBuffer) return this.shortYowlBuffer;
    const { sourceRate, leftCenter, rightCenter, crossfadeSamples } = siameseYowl;
    const ratio = full.sampleRate / sourceRate;
    const left = Math.round((leftCenter - crossfadeSamples / 2) * ratio);
    const right = Math.round((rightCenter - crossfadeSamples / 2) * ratio);
    const fade = Math.round(crossfadeSamples * ratio);
    const result = ctx.createBuffer(full.numberOfChannels, full.length - (right - left), full.sampleRate);
    for (let channel = 0; channel < full.numberOfChannels; channel++) {
      const input = full.getChannelData(channel);
      const output = result.getChannelData(channel);
      output.set(input.subarray(0, left));
      for (let i = 0; i < fade; i++) {
        const blend = (1 - Math.cos(Math.PI * i / (fade - 1))) / 2;
        output[left + i] = input[left + i] * (1 - blend) + input[right + i] * blend;
      }
      output.set(input.subarray(right + fade), left + fade);
    }
    this.shortYowlBuffer = result;
    return result;
  }

  private playDecodedYowlBuffer(ctx: AudioContext, recording: AudioBuffer, shortTake: boolean): void {
    const buf = shortTake ? this.shortYowl(ctx, recording) : recording;
    // Skip the quiet MP3 lead-in so the first voiced attack lands on the paw contact.
    const offset = 0.03;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.46, t0 + 0.006);
    gain.gain.setValueAtTime(0.46, t0 + Math.max(0.05, buf.duration - offset - 0.14));
    gain.gain.linearRampToValueAtTime(0.0001, t0 + buf.duration - offset);
    src.connect(gain);
    gain.connect(this.getMasterOutput(ctx));
    this.yowlSource = src;
    this.yowlGain = gain;
    src.onended = () => {
      if (this.yowlSource === src) {
        this.yowlSource = null;
        this.yowlGain = null;
      }
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
    src.start(t0, offset);
  }

  /**
   * Start the recorded warble on the first tail contact.
   */
  public playHandoverSquabble(
    newSpecies: 'cat' | 'other' = 'cat',
    oldSpecies: 'cat' | 'other' = 'cat',
    recording: 'full' | 'short' = 'full',
  ): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    this.stopHandoverYowl();
    const request = this.yowlRequest;
    try {
      if (newSpecies === 'cat' || oldSpecies === 'cat') {
        if (this.yowlBuffer) {
          this.playDecodedYowlBuffer(ctx, this.yowlBuffer, recording === 'short');
          return;
        }
        if (this.yowlDecodeFailedCtx !== ctx) {
          this.prewarmHandoverYowlBuffer(ctx);
          const pending = this.yowlDecodePromise;
          if (pending) {
            void pending.then(() => {
              if (
                this.yowlRequest === request &&
                this.enabled &&
                !this.isEffectivelyMuted() &&
                this.ctx === ctx &&
                this.yowlBuffer
              ) {
                this.playDecodedYowlBuffer(ctx, this.yowlBuffer, recording === 'short');
              }
            });
            return;
          }
        }
      }

      const t0 = ctx.currentTime + 0.015;
      this.scheduleHandoverCall(ctx, oldSpecies, t0, 0.94, 0.088, -0.24);
      this.scheduleHandoverCall(ctx, newSpecies, t0 + 0.11, 1.07, 0.092, 0.24);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }
}

export const TAIL_YOWL_DURATION_SEC = 0.96;

// Measured 40ms-step vocal amplitude envelope of the trimmed "老吴~" tail-poke angry yowl (0.00s..0.92s):
// Syllable 1 ("老": 0.00-0.14s wide open) -> crisp articulation dip (0.16-0.24s) -> Syllable 2 ("吴~": 0.28-0.82s pursed swell).
const TAIL_YOWL_OPEN_ENV: readonly number[] = [
  0.82, 1.0, 0.92, 0.78, 0.44, 0.48, 0.52, 0.62, 0.64, 0.74,
  0.88, 0.84, 0.88, 0.94, 0.90, 0.78, 0.66, 0.58, 0.52, 0.44,
  0.34, 0.10, 0.02, 0.0, 0.0,
];
// Vowel horizontal width factor: wide expressive "ω" open for "老" (a/ao), pursing into a cute rounded "O" for "吴~" (u/wu).
const TAIL_YOWL_WIDTH_ENV: readonly number[] = [
  1.10, 1.16, 1.12, 1.04, 0.86, 0.80, 0.76, 0.72, 0.68, 0.66,
  0.64, 0.64, 0.63, 0.64, 0.64, 0.65, 0.66, 0.68, 0.70, 0.74,
  0.78, 0.84, 0.92, 1.0, 1.0,
];

export function sampleTailYowlMouth(elapsedSec: number): { open: number; width: number } {
  if (elapsedSec < 0 || elapsedSec >= TAIL_YOWL_DURATION_SEC) {
    return { open: 0, width: 1 };
  }
  const idxF = elapsedSec / 0.04;
  const i0 = Math.min(TAIL_YOWL_OPEN_ENV.length - 1, Math.floor(idxF));
  const i1 = Math.min(TAIL_YOWL_OPEN_ENV.length - 1, i0 + 1);
  const frac = idxF - i0;
  return {
    open: TAIL_YOWL_OPEN_ENV[i0] + (TAIL_YOWL_OPEN_ENV[i1] - TAIL_YOWL_OPEN_ENV[i0]) * frac,
    width: TAIL_YOWL_WIDTH_ENV[i0] + (TAIL_YOWL_WIDTH_ENV[i1] - TAIL_YOWL_WIDTH_ENV[i0]) * frac,
  };
}

export const catAudio = new CatAudio();
