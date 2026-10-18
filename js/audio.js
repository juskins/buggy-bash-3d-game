// All sound is synthesised with WebAudio, so the game ships no audio files.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Browsers only allow audio after a key press or click.
  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Engine
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    this.osc1.connect(this.engineFilter);
    this.osc2.connect(g2).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // Waves on the shore
    const waves = ctx.createBufferSource();
    waves.buffer = this.noise;
    waves.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 600;
    wf.Q.value = 0.4;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 0.035;
    lfo.connect(lg).connect(wg.gain);
    waves.connect(wf).connect(wg).connect(this.master);
    waves.start();
    lfo.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }

  engine(speed, throttle, boosting) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 52 + speed * 3.4 + (boosting ? 18 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(380 + speed * 28 + throttle * 300, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.035 + throttle * 0.045, t, 0.08);
  }

  silenceEngine() {
    if (this.ctx) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  tone(freq, duration, { type = 'sine', volume = 0.2, delay = 0, slide = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  bump(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300 + strength * 40;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.6, 0.12 + strength * 0.03), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.3);
    this.tone(90, 0.18, { type: 'triangle', volume: 0.25, slide: -50 });
  }

  pickup() {
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', volume: 0.18, delay: i * 0.06 }));
    this.tone(180, 0.5, { type: 'sawtooth', volume: 0.1, slide: 500 });
  }

  beep(high = false) {
    this.tone(high ? 880 : 440, high ? 0.5 : 0.18, { type: 'square', volume: 0.15 });
  }

  lap() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', volume: 0.2, delay: i * 0.09 }));
  }

  finish() {
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', volume: 0.22, delay: i * 0.12 }));
  }
}
