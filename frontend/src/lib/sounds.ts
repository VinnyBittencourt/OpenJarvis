// Interface sounds, synthesized with the Web Audio API (no audio files). Short and quiet on
// purpose: they confirm that something happened without competing with the voice.
// Turn off with localStorage 'jarvis-sounds' = '0' (System > Voz e desempenho).
export type Sound = 'wake' | 'sent' | 'alert' | 'milestone' | 'off' | 'interrupt';

let ctx: AudioContext | null = null;

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem('jarvis-sounds') !== '0';
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean): void {
  try {
    localStorage.setItem('jarvis-sounds', on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

// [frequency Hz, start s, duration s, peak gain]
const SCORES: Record<Sound, Array<[number, number, number, number]>> = {
  wake: [[660, 0, 0.09, 0.09], [990, 0.07, 0.14, 0.09]],
  sent: [[1320, 0, 0.05, 0.05]],
  interrupt: [[880, 0, 0.06, 0.08], [660, 0.05, 0.1, 0.07]],
  alert: [[784, 0, 0.12, 0.09], [1047, 0.13, 0.2, 0.09]],
  off: [[660, 0, 0.1, 0.08], [440, 0.09, 0.22, 0.07]],
  milestone: [[523, 0, 0.5, 0.07], [659, 0.1, 0.5, 0.07], [784, 0.2, 0.5, 0.07], [1047, 0.32, 0.9, 0.08], [1568, 0.44, 1.1, 0.04]],
};

export function playSound(name: Sound): void {
  if (!soundsEnabled()) return;
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, start, dur, peak] of SCORES[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = name === 'milestone' ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.03);
    }
  } catch {
    /* sounds are optional */
  }
}
