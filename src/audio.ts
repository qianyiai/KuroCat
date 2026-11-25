/** Recordings longer than this are trimmed: a purr loop only needs a short clip. */
const MAX_CUSTOM_PURR_SEC = 60;
/** Length of the tail→head crossfade that hides the loop seam of a real recording. */
const LOOP_CROSSFADE_SEC = 0.45;
/**
 * RMS a custom recording is normalized to, so it sits at the same loudness as
 * the built-in synthesized purr (measured ≈0.055 RMS) under the same petting-intensity gain.
 */
const CUSTOM_PURR_TARGET_RMS = 0.055;

/**
 * Turns a decoded recording into a buffer that loops without a click: the last
 * `fade` seconds are blended into the first ones with an equal-power curve, and
 * the result is normalized to {@link CUSTOM_PURR_TARGET_RMS} (peak-limited).
 */
export function buildSeamlessPurrLoop(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const rate = src.sampleRate;
  const len = Math.min(src.length, Math.floor(MAX_CUSTOM_PURR_SEC * rate));
  const fade = Math.min(Math.floor(LOOP_CROSSFADE_SEC * rate), Math.floor(len / 4));
  const outLen = len - fade;
  const out = ctx.createBuffer(src.numberOfChannels, outLen, rate);

  let sumSq = 0;
  let peak = 0;
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const a = src.getChannelData(ch);
    const o = out.getChannelData(ch);
    for (let i = 0; i < outLen; i++) {
      let v = a[i];
      if (i < fade) {
        const t = (i + 0.5) / fade;
        v = a[i] * Math.sin(t * Math.PI * 0.5) + a[outLen + i] * Math.cos(t * Math.PI * 0.5);
      }
      o[i] = v;
      sumSq += v * v;
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
    }
  }

  const rms = Math.sqrt(sumSq / Math.max(1, outLen * src.numberOfChannels));
  if (rms > 1e-5) {
    const gain = Math.min(CUSTOM_PURR_TARGET_RMS / rms, 0.98 / Math.max(peak, 1e-5));
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const o = out.getChannelData(ch);
      for (let i = 0; i < outLen; i++) o[i] *= gain;
    }
  }
  return out;
}

class CatAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private graphReady = false;
  private masterGain: GainNode | null = null;
  private currentIntensity = 0;
  /** Started source/LFO nodes of the current purr graph, stopped on rebuild. */
  private graphSources: AudioScheduledSourceNode[] = [];
  private customLoop: AudioBuffer | null = null;

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.setPurrIntensity(0);
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    return this.ctx;
  }

  /**
   * Switches the purr to a user recording (`null` = built-in synthesized purr).
   * Rejects when the data cannot be decoded; the current purr is kept then.
   */
  public async setCustomPurr(data: ArrayBuffer | null): Promise<void> {
    if (!data || data.byteLength === 0) {
      if (!this.customLoop) return;
      this.customLoop = null;
    } else {
      const ctx = this.ensureContext();
      if (!ctx) throw new Error('Web Audio unavailable');
      const decoded = await ctx.decodeAudioData(data.slice(0));
      if (decoded.length < decoded.sampleRate * 0.2) {
        throw new Error('recording too short');
      }
      this.customLoop = buildSeamlessPurrLoop(ctx, decoded);
    }
    this.teardownGraph();
  }

  /** Plays the current purr at full intensity for a moment, so a new choice can be heard. */
  public preview(durationMs = 1800): void {
    if (!this.enabled) return;
    this.setPurrIntensity(0.85);
    window.setTimeout(() => this.setPurrIntensity(0), durationMs);
  }

  private teardownGraph(): void {
    if (!this.graphReady) return;
    for (const node of this.graphSources) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
      node.disconnect();
    }
    this.graphSources = [];
    this.masterGain?.disconnect();
    this.masterGain = null;
    this.graphReady = false;
    const resume = this.currentIntensity;
    this.currentIntensity = 0;
    if (resume > 0.01) this.setPurrIntensity(resume);
  }

  private ensurePurrGraph(): boolean {
    if (!this.enabled) return false;
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    if (this.graphReady) return true;

    // Master output gain (starts silent, ramps smoothly during petting)
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    if (this.customLoop) {
      const loopSrc = ctx.createBufferSource();
      loopSrc.buffer = this.customLoop;
      loopSrc.loop = true;
      loopSrc.connect(master);
      loopSrc.start();
      this.graphSources = [loopSrc];
    } else {
      this.graphSources = this.buildSynthPurr(ctx, master);
    }

    this.masterGain = master;
    this.graphReady = true;
    return true;
  }

  /** Built-in synthesized purr; returns its started nodes. */
  private buildSynthPurr(ctx: AudioContext, master: GainNode): AudioScheduledSourceNode[] {
    const sampleRate = ctx.sampleRate;
    const bufLen = Math.floor(sampleRate * 3.0);
    const noiseBuf = ctx.createBuffer(1, bufLen, sampleRate);
    const data = noiseBuf.getChannelData(0);
    // Smooth warm noise buffer for organic feline throat & breath texture
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    // Layer 1: Warm chest rumble (~190 Hz)
    const warmFilter = ctx.createBiquadFilter();
    warmFilter.type = 'bandpass';
    warmFilter.frequency.value = 190;
    warmFilter.Q.value = 1.15;
    const warmGain = ctx.createGain();
    warmGain.gain.value = 1.45;

    // Layer 2: Soft breathy throat resonance (~520 Hz)
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = 520;
    breathFilter.Q.value = 1.4;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.34;

    // 24.5 Hz feline purr flutter amplitude modulation (0.30 .. 1.00)
    const flutterGain = ctx.createGain();
    flutterGain.gain.value = 0.65;
    const flutterLfo = ctx.createOscillator();
    flutterLfo.type = 'sine';
    flutterLfo.frequency.value = 24.5;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.35;
    flutterLfo.connect(flutterDepth);
    flutterDepth.connect(flutterGain.gain);

    // Slow cozy breathing cadence (~0.68 Hz: inhale/exhale swell)
    const breathCycleGain = ctx.createGain();
    breathCycleGain.gain.value = 0.76;
    const breathLfo = ctx.createOscillator();
    breathLfo.type = 'sine';
    breathLfo.frequency.value = 0.68;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.24;
    breathLfo.connect(breathDepth);
    breathDepth.connect(breathCycleGain.gain);

    // Soft lowpass polish so it sounds cozy on both speakers & headphones
    const polishFilter = ctx.createBiquadFilter();
    polishFilter.type = 'lowpass';
    polishFilter.frequency.value = 1400;

    noiseSrc.connect(warmFilter);
    warmFilter.connect(warmGain);
    warmGain.connect(flutterGain);

    noiseSrc.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(flutterGain);

    flutterGain.connect(breathCycleGain);
    breathCycleGain.connect(polishFilter);
    polishFilter.connect(master);

    noiseSrc.start();
    flutterLfo.start();
    breathLfo.start();
    return [noiseSrc, flutterLfo, breathLfo];
  }

  /**
   * Smoothly drives real-time organic cat purring (0 = silent, 1 = full cozy purr).
   */
  public setPurrIntensity(intensity: number): void {
    const target = this.enabled ? Math.max(0, Math.min(1, intensity)) : 0;
    if (target <= 0.01 && !this.graphReady) return;
    if (Math.abs(target - this.currentIntensity) < 0.005) return;
    this.currentIntensity = target;

    if (target > 0.01 && !this.ensurePurrGraph()) return;
    if (!this.ctx || !this.masterGain) return;

    if (target > 0.01 && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime;
    const targetGain = target * 0.26;
    const timeConst = target > 0.01 ? 0.14 : 0.22;
    this.masterGain.gain.setTargetAtTime(targetGain, now, timeConst);
  }
}

export const catAudio = new CatAudio();
