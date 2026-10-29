import type { Tier } from "~/features/prizes/prize";

/** Sound and vibration for the spin page. Browser only; every call is a no-op on the server. */

export function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let audio: AudioContext | null = null;
let soundOn = true;

export function setSoundOn(value: boolean) {
  soundOn = value;
}

function context() {
  if (!soundOn || typeof AudioContext === "undefined") return null;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function tone(
  frequency: number,
  duration: number,
  {
    type = "square",
    gain = 0.05,
    at = 0,
    slideTo,
  }: { type?: OscillatorType; gain?: number; at?: number; slideTo?: number } = {},
) {
  const ctx = context();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  volume.gain.setValueAtTime(gain, start);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

let lastTick = 0;

export const sfx = {
  /** The pointer passed a slice boundary. */
  tick() {
    const now = performance.now();
    if (now - lastTick < 35) return;
    lastTick = now;
    tone(2100, 0.03, { gain: 0.03 });
  },
  /** Charging the spin by holding the button. */
  ratchet(level: number) {
    tone(480 + level * 900, 0.03, { type: "triangle", gain: 0.06 });
  },
  reveal(tier: Tier) {
    if (tier === "jackpot") {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { gain: 0.06, at: i * 0.11 }));
      for (const f of [1047, 1319, 1568]) tone(f, 1, { type: "triangle", gain: 0.05, at: 0.46 });
      [2093, 2637, 3136, 2637, 3136, 4186].forEach((f, i) =>
        tone(f, 0.09, { type: "sine", gain: 0.03, at: 0.6 + i * 0.08 }),
      );
    } else if (tier === "win") {
      [784, 1047, 1319].forEach((f, i) => tone(f, 0.14, { gain: 0.05, at: i * 0.09 }));
      tone(1568, 0.5, { type: "triangle", gain: 0.05, at: 0.3 });
    } else {
      tone(392, 0.28, { type: "triangle", gain: 0.07, slideTo: 370 });
      tone(330, 0.6, { type: "triangle", gain: 0.07, at: 0.32, slideTo: 247 });
    }
  },
};

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iOS Safari has no vibration.
  }
}

export const revealVibration: Record<Tier, number[]> = {
  jackpot: [80, 40, 80, 40, 260],
  win: [60, 30, 120],
  lose: [30],
};
