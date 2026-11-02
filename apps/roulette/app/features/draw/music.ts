import { context, noise, tone } from "./feedback";

/**
 * The spin page's background music: a bouncy four-bar loop (C, Am, F, G),
 * synthesized so there is no audio file to load or license. A look-ahead
 * scheduler queues each 16th note on the AudioContext clock. Browsers only
 * allow sound after a tap, so the page starts it on the first one.
 */

export type Mood = "idle" | "spin" | "quiet";

const BPM = 132;
const STEP = 60 / BPM / 4;
const STEPS = 64;
const LOOKAHEAD = 0.3;
const VOLUME: Record<Mood, number> = { idle: 0.55, spin: 0.75, quiet: 0 };

const C3 = 130.81;
const note = (semitones: number) => C3 * 2 ** (semitones / 12);

/** Semitones above C3: root, third, fifth of C, Am, F, G. */
const chords = [
  [0, 4, 7],
  [-3, 0, 4],
  [-7, -3, 0],
  [-5, -1, 2],
];
const arpeggio = [0, 1, 2, 1];
/** One note per 8th (null rests), an octave above the chord. */
const melody = [
  [24, null, 19, 21, 24, null, 26, 28],
  [24, null, 21, null, 19, 21, 24, null],
  [21, null, 24, 26, 28, null, 26, 24],
  [26, null, 23, null, 26, 28, 31, null],
];

const state = {
  playing: false,
  timer: 0,
  next: 0,
  step: 0,
  mood: "idle" as Mood,
  fader: null as GainNode | null,
};

function play(step: number, at: number) {
  const out = state.fader ?? undefined;
  const bar = Math.floor(step / 16) % 4;
  const beat = step % 16;
  const chord = chords[bar] ?? [0, 4, 7];
  const root = chord[0] ?? 0;
  if (beat % 4 === 0) tone(110, 0.16, { type: "sine", gain: 0.5, at, slideTo: 40, out });
  if (beat % 4 === 2) noise(0.04, { gain: 0.18, at, from: 7000, to: 9000, out });
  if (state.mood === "spin" && beat % 2 === 1)
    noise(0.025, { gain: 0.1, at, from: 9000, to: 11000, out });
  if (beat % 2 === 0)
    tone(note(root - 12 + (beat % 4 === 2 ? 12 : 0)), STEP * 1.8, {
      type: "triangle",
      gain: 0.22,
      at,
      out,
    });
  tone(note(12 + (chord[arpeggio[beat % 4] ?? 0] ?? 0)), STEP * 0.9, { gain: 0.035, at, out });
  const lead = beat % 2 === 0 ? melody[bar]?.[beat / 2] : null;
  if (lead != null) tone(note(lead), STEP * 1.7, { type: "triangle", gain: 0.11, at, out });
}

function schedule() {
  const ctx = context();
  if (!ctx || !state.playing) return;
  // After the tab sleeps, pick up from now rather than replaying what was missed.
  if (state.next < ctx.currentTime) state.next = ctx.currentTime + 0.05;
  while (state.next < ctx.currentTime + LOOKAHEAD) {
    play(state.step, state.next - ctx.currentTime);
    state.next += STEP;
    state.step = (state.step + 1) % STEPS;
  }
}

function fade(volume: number, seconds: number) {
  const ctx = context();
  const gain = state.fader?.gain;
  if (!ctx || !gain) return;
  gain.cancelScheduledValues(ctx.currentTime);
  gain.setValueAtTime(gain.value, ctx.currentTime);
  gain.linearRampToValueAtTime(volume, ctx.currentTime + seconds);
}

export const music = {
  /** Start the loop. Call from a tap; does nothing while sound is off or already playing. */
  start() {
    const ctx = context();
    if (!ctx || state.playing) return;
    state.fader = ctx.createGain();
    state.fader.gain.value = 0;
    state.fader.connect(ctx.destination);
    state.playing = true;
    state.next = ctx.currentTime + 0.05;
    state.step = 0;
    schedule();
    state.timer = window.setInterval(schedule, 100);
    fade(VOLUME[state.mood], 1.2);
  },
  stop() {
    if (!state.playing) return;
    state.playing = false;
    clearInterval(state.timer);
    const fader = state.fader;
    fade(0, 0.3);
    window.setTimeout(() => fader?.disconnect(), 400);
    state.fader = null;
  },
  /** Louder with double-time hats while spinning; silent through a reach and the fanfare. */
  setMood(mood: Mood) {
    if (state.mood === mood) return;
    state.mood = mood;
    fade(VOLUME[mood], mood === "quiet" ? 0.35 : 0.8);
  },
};
