import type { Tier } from "~/features/prizes/prize";
import type { CutInLevel } from "./staging";

/** Sound, vibration and shake for the spin page. Browser only; every call is a no-op on the server. */

export function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let audio: AudioContext | null = null;
let soundOn = true;

export function setSoundOn(value: boolean) {
  soundOn = value;
}

/** The shared AudioContext, or null while sound is off or unsupported. */
export function context() {
  if (!soundOn || typeof AudioContext === "undefined") return null;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

type Voice = { gain?: number; at?: number; out?: AudioNode };

/** A note `at` seconds from now; `out` routes it (to the BGM's fader) instead of the speakers. */
export function tone(
  frequency: number,
  duration: number,
  {
    type = "square",
    gain = 0.05,
    at = 0,
    slideTo,
    out,
  }: Voice & { type?: OscillatorType; slideTo?: number } = {},
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
  oscillator.connect(volume).connect(out ?? ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;

/** A burst of band-passed noise sweeping from `from` to `to` Hz: whooshes, crashes and hats. */
export function noise(
  duration: number,
  { gain = 0.08, at = 0, from = 400, to = 4000, out }: Voice & { from?: number; to?: number } = {},
) {
  const ctx = context();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  // One second of noise, made once and looped from a random point.
  if (noiseBuffer?.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + duration);
  const volume = ctx.createGain();
  volume.gain.setValueAtTime(gain, start);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source
    .connect(filter)
    .connect(volume)
    .connect(out ?? ctx.destination);
  source.start(start, Math.random() * 0.5);
  source.stop(start + duration + 0.02);
}

const cutInChord: Record<CutInLevel, number[]> = {
  blue: [659, 988],
  red: [784, 1175, 1568],
  gold: [1047, 1319, 1568, 2093],
};

let lastTick = 0;

export const sfx = {
  /** The pointer passed a slice boundary; `strong` while crawling through a reach. */
  tick(strong = false) {
    const now = performance.now();
    if (now - lastTick < 35) return;
    lastTick = now;
    if (strong) tone(1500, 0.06, { gain: 0.07 });
    else tone(2100, 0.03, { gain: 0.03 });
  },
  /** The reach cut-in slashing across: a whoosh and a chord, bigger with the level. */
  cutIn(level: CutInLevel) {
    noise(0.35, { gain: 0.12, from: 300, to: 6000 });
    cutInChord[level].forEach((f, i) =>
      tone(f, 0.5, { type: "sawtooth", gain: 0.035, at: 0.08 + i * 0.03 }),
    );
    if (level === "gold")
      [2093, 2637, 3136, 4186].forEach((f, i) =>
        tone(f, 0.12, { type: "sine", gain: 0.03, at: 0.3 + i * 0.07 }),
      );
  },
  /** One heartbeat while the wheel crawls. */
  heartbeat() {
    tone(90, 0.12, { type: "sine", gain: 0.3, slideTo: 50 });
    tone(80, 0.14, { type: "sine", gain: 0.22, at: 0.17, slideTo: 45 });
  },
  /** The revival jolt: a crash and a rising run. */
  revive() {
    tone(120, 0.3, { gain: 0.1, slideTo: 60 });
    noise(0.4, { gain: 0.15, from: 2000, to: 200 });
    [523, 784, 1047, 1568, 2093].forEach((f, i) =>
      tone(f, 0.1, { type: "triangle", gain: 0.05, at: 0.08 + i * 0.05 }),
    );
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

function isIos() {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

let switchLabel: HTMLLabelElement | null = null;

/**
 * iOS Safari has no Vibration API, but since iOS 18 toggling an
 * `<input type="checkbox" switch>` plays a haptic tick. Best effort: Safari
 * may only allow it shortly after a tap.
 */
function iosTap() {
  if (!switchLabel) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    switchLabel = label;
  }
  switchLabel.click();
}

/** Vibrate in a pattern of on/off milliseconds; on iOS, haptic ticks through each "on". */
export function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
      return;
    }
    if (!isIos()) return;
    const steps = typeof pattern === "number" ? [pattern] : pattern;
    let at = 0;
    steps.forEach((ms, i) => {
      // On: a tick every 70 ms, at least one. Off: wait.
      if (i % 2 === 0)
        for (let t = 0; t < Math.max(ms, 1); t += 70) window.setTimeout(iosTap, at + t);
      at += ms;
    });
  } catch {
    // No haptics on this device.
  }
}

export const revealVibration: Record<Tier, number[]> = {
  jackpot: [80, 40, 80, 40, 260],
  win: [60, 30, 120],
  lose: [30],
};

export const cutInVibration: Record<CutInLevel, number[]> = {
  blue: [60, 40, 120],
  red: [80, 40, 80, 40, 200],
  gold: [100, 30, 100, 30, 100, 30, 320],
};

export const heartbeatVibration = [25, 110, 35];
export const reviveVibration = [150, 50, 150, 50, 300];

/** Shake an element, `power` pixels at first, dying down. */
export function shake(element: HTMLElement | null, power: number) {
  if (!element || reducedMotion()) return;
  const frames = Array.from({ length: 9 }, (_, i) => {
    const p = power * (1 - i / 9);
    return { translate: `${i % 2 ? -p : p}px ${(((i * 7) % 3) - 1) * p * 0.6}px` };
  });
  element.animate([...frames, { translate: "0 0" }], { duration: 450, easing: "ease-out" });
}
