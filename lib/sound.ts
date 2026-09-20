// Procedural UI sound effects with the Web Audio API — no audio files, no background music.
class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = true;
  private listeners = new Set<(m: boolean) => void>();

  private init() {
    if (this.ctx || typeof window === "undefined") return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  subscribe(fn: (m: boolean) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  setMuted(m: boolean) {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.muted = m;
    this.listeners.forEach((f) => f(m));
  }

  toggle() {
    this.setMuted(!this.muted);
  }

  private blip(freq: number, dur = 0.06, type: OscillatorType = "square", vol = 0.05, when = 0, slideTo?: number) {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  tick() { this.blip(1800 + Math.random() * 400, 0.025, "square", 0.012); }
  hover() { this.blip(2600, 0.03, "sine", 0.02); }
  send() { this.blip(220, 0.35, "sawtooth", 0.05, 0, 880); }
  bootLine() { this.blip(900 + Math.random() * 300, 0.04, "square", 0.02); }
  enter() {
    this.blip(110, 1.2, "sawtooth", 0.08, 0, 55);
    [440, 554.37, 659.25, 880].forEach((f, i) => this.blip(f, 0.5, "triangle", 0.05, 0.08 * i));
  }
  // one note per retrieved passage — higher = more relevant
  retrieval(count: number) {
    const scale = [987.77, 880, 783.99, 659.25, 587.33];
    for (let i = 0; i < count; i++) this.blip(scale[i] || 523.25, 0.22, "triangle", 0.045, 0.09 * i);
  }
  // Rocky speaks in musical chords. amaze! amaze! amaze!
  amaze() {
    const chords = [[523.25, 659.25, 783.99], [587.33, 739.99, 880], [659.25, 830.61, 987.77]];
    chords.forEach((ch, i) => ch.forEach((f) => this.blip(f, 0.28, "triangle", 0.05, i * 0.3)));
  }
  error() { this.blip(160, 0.4, "sawtooth", 0.06, 0, 80); }
}

export const sound = new SoundEngine();
