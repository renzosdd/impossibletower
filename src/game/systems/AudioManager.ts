import type { Settings } from '../../types';

type AudioContextConstructor = new () => AudioContext;

/** Tiny synthesized placeholders: no audio files, network requests, or autoplay. */
export class AudioManager {
  private settings: Settings;
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private unlocked = false;
  private paused = false;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private melodyStep = 0;

  constructor(settings: Settings) {
    this.settings = { ...settings };
  }

  /** Call directly from the first pointer/keyboard gesture for Safari and Chrome. */
  unlock(): void {
    try {
      if (typeof window === 'undefined') return;
      if (!this.context) {
        const audioWindow = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
        const Constructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
        if (!Constructor) return;
        const context = new Constructor();
        this.context = context;
        this.effects = context.createGain();
        this.effects.gain.value = this.settings.sfx ? 0.25 : 0;
        this.effects.connect(context.destination);
        this.music = context.createGain();
        this.music.gain.value = this.settings.music ? 0.055 : 0;
        this.music.connect(context.destination);
      }
      this.unlocked = true;
      if (!this.paused && this.context) {
        void this.context.resume().then(() => this.updateMusic()).catch(() => undefined);
      }
    } catch { /* Restricted WebAudio must never prevent starting a run. */ }
  }

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
    try {
      if (this.context && this.effects && this.music) {
        this.effects.gain.setTargetAtTime(settings.sfx ? 0.25 : 0, this.context.currentTime, 0.02);
        this.music.gain.setTargetAtTime(settings.music ? 0.055 : 0, this.context.currentTime, 0.04);
      }
      this.updateMusic();
    } catch { /* A closed/unavailable context is optional. */ }
  }

  pause(paused: boolean): void {
    this.paused = paused;
    this.updateMusic();
    try {
      if (!this.context) return;
      if (paused) void this.context.suspend().catch(() => undefined);
      else if (this.unlocked) void this.context.resume().then(() => this.updateMusic()).catch(() => undefined);
    } catch { /* Browser/OS audio interruption is harmless. */ }
  }

  play(name: string, weight = 1): void {
    if (!this.settings.sfx || this.paused || !this.unlocked || !this.context || !this.effects) return;
    if (this.context.state !== 'running') return;
    const heft = Number.isFinite(weight) ? Math.max(0.4, Math.min(6, weight)) : 1;
    try {
      switch (name) {
        case 'drop': this.tone(510, 180, 0.13, 'sine', 0.36); break;
        case 'impact_light':
          this.tone(250 / Math.sqrt(heft), 105, 0.12, 'triangle', 0.7);
          this.noise(0.055, 0.17); break;
        case 'impact_heavy':
          this.tone(125 / Math.sqrt(heft), 44, 0.23, 'sine', 0.95);
          this.noise(0.1, 0.25); break;
        case 'perfect': this.notes([523.25, 659.25, 783.99], 0.06, 0.17, 0.35); break;
        case 'combo': this.notes([659.25, 783.99, 1046.5], 0.05, 0.18, 0.34); break;
        case 'collapse':
          this.tone(155, 37, 0.48, 'triangle', 0.75);
          this.noise(0.34, 0.23); break;
        case 'game_over': this.notes([392, 329.63, 261.63], 0.11, 0.19, 0.3); break;
        case 'new_record': this.notes([523.25, 659.25, 783.99, 1046.5], 0.08, 0.22, 0.35); break;
        case 'button': this.tone(660, 800, 0.055, 'sine', 0.22); break;
        default: this.tone(380, 240, 0.085, 'sine', 0.24);
      }
    } catch { /* Clean placeholders can be replaced without coupling audio to physics. */ }
  }

  haptic(pattern: number | number[] = 18): void {
    if (!this.settings.haptics || this.paused || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const clamp = (duration: number): number => Number.isFinite(duration) ? Math.max(0, Math.min(200, Math.round(duration))) : 0;
    const safe = Array.isArray(pattern) ? pattern.slice(0, 10).map(clamp) : clamp(pattern);
    try { navigator.vibrate(safe); } catch { /* iOS and unsupported devices simply omit haptics. */ }
  }

  destroy(): void {
    this.stopMusic();
    try { if (this.context) void this.context.close().catch(() => undefined); } catch { /* Optional cleanup. */ }
    this.context = null;
    this.effects = null;
    this.music = null;
    this.unlocked = false;
  }

  private tone(startFrequency: number, endFrequency: number, duration: number, type: OscillatorType, volume: number, delay = 0, destination = this.effects): void {
    if (!this.context || !destination) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  }

  private notes(frequencies: number[], spacing: number, duration: number, volume: number): void {
    frequencies.forEach((frequency, index) => this.tone(frequency, frequency * 0.98, duration, 'sine', volume, index * spacing));
  }

  private noise(duration: number, volume: number): void {
    if (!this.context || !this.effects) return;
    const buffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * duration), this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length) ** 2;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    gain.gain.value = volume;
    source.connect(filter); filter.connect(gain); gain.connect(this.effects);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  }

  private updateMusic(): void {
    if (!this.settings.music || this.paused || !this.unlocked || !this.context || !this.music) {
      this.stopMusic();
      return;
    }
    if (this.musicTimer) return;
    const melody = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23];
    this.musicTimer = setInterval(() => {
      if (!this.context || this.context.state !== 'running' || !this.music) return;
      try {
        const note = melody[this.melodyStep % melody.length];
        this.melodyStep += 1;
        this.tone(note, note, 0.42, 'sine', 0.23, 0, this.music);
        this.tone(note / 2, note / 2, 0.48, 'sine', 0.15, 0, this.music);
      } catch { /* Music remains optional. */ }
    }, 570);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
