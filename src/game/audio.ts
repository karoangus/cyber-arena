/**
 * موتور صدا - تمام افکت‌ها به صورت زنده با WebAudio ساخته می‌شوند
 * (بدون فایل صوتی، مناسب بیلد تک‌فایلی)
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  enabled = true;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.75;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0.75 : 0, this.ctx.currentTime, 0.05);
    }
    if (!v) {
      this.stopAmbient();
    } else {
      this.startAmbient();
    }
  }

  private noiseBuffer(ctx: AudioContext, seconds = 0.5) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.25,
    slideTo?: number,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, freq: number, gain = 0.3, q = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  shoot() {
    this.noiseBurst(0.12, 1500, 0.22, 0.8);
    this.blip(880, 0.1, "square", 0.12, 180);
  }

  hit() {
    this.blip(1600, 0.06, "triangle", 0.18, 1100);
  }

  kill() {
    this.noiseBurst(0.4, 500, 0.35, 0.5);
    this.blip(320, 0.35, "sawtooth", 0.2, 60);
  }

  damage() {
    this.blip(150, 0.28, "sawtooth", 0.26, 60);
    this.noiseBurst(0.18, 260, 0.22, 0.7);
  }

  pickup() {
    this.blip(660, 0.09, "sine", 0.2);
    window.setTimeout(() => this.blip(990, 0.12, "sine", 0.18), 80);
  }

  reload() {
    this.noiseBurst(0.06, 2400, 0.16, 3);
    window.setTimeout(() => this.noiseBurst(0.08, 1500, 0.18, 2), 220);
  }

  empty() {
    this.noiseBurst(0.04, 3200, 0.12, 6);
  }

  wave() {
    this.blip(440, 0.16, "triangle", 0.2);
    window.setTimeout(() => this.blip(660, 0.16, "triangle", 0.2), 140);
    window.setTimeout(() => this.blip(880, 0.3, "triangle", 0.22), 290);
  }

  blast() {
    this.noiseBurst(0.7, 200, 0.4, 0.4);
    this.blip(90, 0.6, "sawtooth", 0.3, 30);
  }

  hurtPlayer() {
    this.blip(220, 0.5, "square", 0.16, 70);
  }

  startAmbient() {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled || this.ambientGain) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    gain.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 3);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(lp.frequency);
    src.connect(lp).connect(gain);
    src.start();
    lfo.start();
    gain.gain.setTargetAtTime(0.09, ctx.currentTime, 1.5);
    this.ambientGain = gain;
    this.ambientNodes = [src, lfo];
  }

  stopAmbient() {
    const ctx = this.ctx;
    const gain = this.ambientGain;
    const nodes = this.ambientNodes;
    // وضعیت را فوری آزاد کن تا startAmbient بعدی بتواند از نو بسازد
    this.ambientGain = null;
    this.ambientNodes = [];
    if (gain && ctx) {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      const stopAt = ctx.currentTime + 0.4;
      for (const node of nodes) {
        const stoppable = node as { stop?: (t?: number) => void };
        if (typeof stoppable.stop === "function") {
          try {
            stoppable.stop(stopAt);
          } catch {
            /* already stopped */
          }
        }
      }
    }
  }
}

export const sound = new SoundEngine();
