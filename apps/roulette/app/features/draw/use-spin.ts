import { useEffect, useRef, useState } from "react";
import { type Segment, mod, rotationFor } from "~/features/prizes/odds";
import type { Prompt } from "./components/ChancePrompt";
import { flickPointer } from "./components/Wheel";
import {
  cutInVibration,
  heartbeatVibration,
  maxVibration,
  promptVibration,
  pushVibration,
  reducedMotion,
  revealVibration,
  sfx,
  shake,
  vibrate,
} from "./feedback";
import type { DrawResult } from "./result";
import {
  type CutInLevel,
  LEVELS,
  type LandingPlan,
  type Stop,
  VARIANTS,
  type Variant,
  planLanding,
} from "./staging";

export type SpinPhase = "idle" | "charge" | "spinning" | "result";
/** The staged finish: crawling after a cut-in, and the dark hush before PUSH. */
export type Staging = "none" | "tension" | "hush";

const CHARGE_MS = 1200;
/** Free spin reaches full speed in this long. */
const RAMP_MS = 180;
/** Spin freely at least this long before slowing down, even when the server is fast. */
const MIN_FREE_MS = 450;
/** Aim for a slow-down of about this long. */
const LAND_MS = 3600;
/** A staged finish slows to a crawl in about this long, then crawls CRAWL_SLICES slices. */
const APPROACH_MS = 2400;
const CRAWL_SLICES = 2.4;
const CRAWL_MS = 3200;
/** 連打: the wheel stays frozen this long while the button asks for taps. */
const RENDA_MS = 3600;
/** Without taps the gauge fills this far by the end; each tap adds TAP_GAIN. */
const RENDA_AUTO_SHARE = 0.7;
const TAP_GAIN = 0.05;
/** 押せ: dark for HUSH_MS after stopping short; the button presses itself after PUSH_WAIT_MS. */
const HUSH_MS = 800;
const PUSH_WAIT_MS = 6000;
/** The jolt from the short stop into the prize, and the hold before the reveal. */
const JOLT_MS = 380;
const JOLT_HOLD_MS = 600;
const HEARTBEAT_MS = 640;
/** Pause between stopping and the reveal. */
const REVEAL_DELAY_MS = 300;
/** Below this speed (degrees per ms), passing a slice boundary also vibrates. */
const SLOW = 0.35;

type Landing = LandingPlan & { result: DrawResult | null };

/**
 * One stretch of the finish: `distance` degrees in `duration` ms along `ease`.
 * A `wait` leg ends early when the PUSH button is pressed.
 */
type Leg = {
  distance: number;
  duration: number;
  ease: (t: number) => number;
  onStart?: () => void;
  wait?: boolean;
};

const easeOut = (power: number) => (t: number) => 1 - (1 - t) ** power;
const still = () => 0;

/** Overshoots a little and settles back: the jolt after PUSH. */
const backOut = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/**
 * Slow from `from` to `to` degrees per ms, braking hard at first and then
 * gently, ending `delta` degrees on (plus whole turns, about APPROACH_MS long).
 */
function approach(delta: number, from: number, to: number): Leg {
  const k = 3;
  const average = to + (from - to) / (k + 1);
  const turns = Math.max(1, Math.round((average * APPROACH_MS - delta) / 360));
  const distance = turns * 360 + delta;
  return {
    distance,
    duration: distance / average,
    ease: (t) => (to * t + ((from - to) * (1 - (1 - t) ** (k + 1))) / (k + 1)) / average,
  };
}

/** Dev only: `?demo=push-gold` (a variant and/or a level) forces a finish, to try each effect. */
function demoForce(): { variant?: Variant; level?: CutInLevel } {
  if (!import.meta.env.DEV) return {};
  const parts = new URLSearchParams(window.location.search).get("demo")?.split("-") ?? [];
  return {
    variant: VARIANTS.find((variant) => parts.includes(variant)),
    level: LEVELS.find((level) => parts.includes(level)),
  };
}

/** Where the wheel rests for a past result: that prize's first slice under the pointer. */
export function restingOn(segments: Segment[], prizeId: string | null) {
  const index = segments.findIndex((segment) => segment.prizeId === prizeId);
  if (index < 0) return { rotation: 0, highlight: undefined };
  return { rotation: rotationFor(index, segments.length), highlight: index };
}

/**
 * Drives the wheel: hold to charge (the wheel winds back), release to spin
 * freely while the server picks the prize, then `land()` eases into the
 * winning slice with no jump in speed and reveals the result — through a
 * staged finish (staging.ts) when one is planned. The wheel's transform is set
 * directly each frame; React state only changes per phase, tap and gauge step.
 */
export function useSpin(segments: Segment[], initial: { rotation: number; highlight?: number }) {
  const [phase, setPhase] = useState<SpinPhase>("idle");
  const [charge, setCharge] = useState(0);
  const [rotation, setRotation] = useState(initial.rotation);
  const [highlight, setHighlight] = useState(initial.highlight);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [staging, setStaging] = useState<Staging>("none");
  const [cutIn, setCutIn] = useState<{ level: CutInLevel; key: number } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [gauge, setGauge] = useState(0);
  const [taps, setTaps] = useState(0);
  const [pushKey, setPushKey] = useState(0);
  const [nearMiss, setNearMiss] = useState(false);
  const wheelRef = useRef<SVGGElement>(null);
  const pointerRef = useRef<SVGGElement>(null);
  /** Shaken by the cut-in, PUSH and the jackpot. */
  const stageRef = useRef<HTMLDivElement>(null);
  const motion = useRef({
    angle: initial.rotation,
    base: initial.rotation,
    level: 0,
    velocity: 0,
    frame: 0,
    timer: 0,
    heartbeat: 0,
    keys: 0,
    /** Crawling after a cut-in: boundaries tick louder and vibrate. */
    tense: false,
    prompt: null as Prompt["kind"] | null,
    gaugeTimer: 0,
    rendaSince: 0,
    taps: 0,
    maxed: false,
    pushed: false,
    freeSince: 0,
    pending: null as Landing | null,
    course: null as {
      landing: Landing;
      legs: Leg[];
      at: number;
      from: number;
      start: number;
    } | null,
  });
  const count = Math.max(segments.length, 1);
  const seg = 360 / count;

  const stopHeartbeat = () => clearInterval(motion.current.heartbeat);

  const endPrompt = () => {
    const m = motion.current;
    clearInterval(m.gaugeTimer);
    m.prompt = null;
    setPrompt(null);
  };

  useEffect(
    () => () => {
      const m = motion.current;
      cancelAnimationFrame(m.frame);
      clearTimeout(m.timer);
      clearInterval(m.heartbeat);
      clearInterval(m.gaugeTimer);
    },
    [],
  );

  const setAngle = (angle: number) => {
    motion.current.angle = angle;
    wheelRef.current?.setAttribute("transform", `rotate(${angle})`);
  };

  const nextKey = () => {
    motion.current.keys += 1;
    return motion.current.keys;
  };

  const showPrompt = (kind: Prompt["kind"], level: CutInLevel) => {
    motion.current.prompt = kind;
    setPrompt({
      kind,
      level,
      key: nextKey(),
      timeout: kind === "push" ? PUSH_WAIT_MS : undefined,
    });
    sfx.prompt();
    vibrate(promptVibration);
  };

  const gaugeNow = () => {
    const m = motion.current;
    const auto = ((performance.now() - m.rendaSince) / RENDA_MS) * RENDA_AUTO_SHARE;
    return Math.min(1, auto + m.taps * TAP_GAIN);
  };

  const updateGauge = () => {
    const m = motion.current;
    const value = gaugeNow();
    setGauge(value);
    if (value >= 1 && !m.maxed) {
      m.maxed = true;
      sfx.max();
      vibrate(maxVibration);
    }
  };

  const startRenda = (level: CutInLevel) => {
    const m = motion.current;
    m.taps = 0;
    m.maxed = false;
    m.rendaSince = performance.now();
    setTaps(0);
    setGauge(0);
    showPrompt("renda", level);
    m.gaugeTimer = window.setInterval(updateGauge, 60);
  };

  const startTension = (level: CutInLevel) => {
    const m = motion.current;
    m.tense = true;
    setStaging("tension");
    setCutIn({ level, key: nextKey() });
    sfx.cutIn(level);
    vibrate(cutInVibration[level]);
    shake(stageRef.current, level === "gold" || level === "rainbow" ? 12 : 7);
    stopHeartbeat();
    m.heartbeat = window.setInterval(() => {
      sfx.heartbeat();
      vibrate(heartbeatVibration);
    }, HEARTBEAT_MS);
  };

  const hush = () => {
    motion.current.tense = false;
    stopHeartbeat();
    setStaging("hush");
  };

  const askPush = (level: CutInLevel) => {
    motion.current.pushed = false;
    showPrompt("push", level);
  };

  /** After 連打, or once PUSH went in (or timed out): flash, shake, jolt into the prize. */
  const jolt = () => {
    motion.current.tense = true;
    endPrompt();
    setStaging("tension");
    setPushKey(nextKey());
    sfx.push();
    vibrate(pushVibration);
    shake(stageRef.current, 18);
  };

  /** The chance button: a tap for 連打, the one press for 押せ. */
  const press = () => {
    const m = motion.current;
    if (m.prompt === "renda") {
      m.taps += 1;
      setTaps(m.taps);
      updateGauge();
      sfx.tap(gaugeNow());
      vibrate(12);
    } else if (m.prompt === "push" && !m.pushed) {
      m.pushed = true;
    }
  };

  const reveal = (landing: Landing) => {
    const m = motion.current;
    m.course = null;
    m.pending = null;
    m.tense = false;
    stopHeartbeat();
    endPrompt();
    setStaging("none");
    setRotation(m.angle);
    if (!landing.result) {
      setPhase("idle");
      return;
    }
    const drawn = landing.result;
    setHighlight(landing.index);
    setResult(drawn);
    setNearMiss(landing.nearMiss);
    setPhase("result");
    setCelebrateKey((key) => key + 1);
    sfx.reveal(drawn.tier);
    vibrate(revealVibration[drawn.tier]);
    if (drawn.tier === "jackpot") shake(stageRef.current, 10);
  };

  /** The legs from the free spin to the stop, starting at `velocity` degrees per ms. */
  const legsFor = (landing: Landing, angle: number, velocity: number): Leg[] => {
    const target = (stop: Stop) => rotationFor(stop.index, count, stop.fraction);
    const level = landing.level;
    if (landing.variant === "plain" || !level) {
      // Ease out (1 − (1 − t)⁴) starts at 4·distance/duration: match the current speed.
      const delta = mod(target(landing) - angle, 360);
      const turns = Math.max(1, Math.round((velocity * LAND_MS) / 4 / 360 - delta / 360));
      const distance = turns * 360 + delta;
      return [{ distance, duration: (4 * distance) / velocity, ease: easeOut(4) }];
    }
    const stop = landing.fakeStop ?? landing;
    const crawl = CRAWL_SLICES * seg;
    // The crawl eases out quadratically, which starts at 2·distance/duration.
    const crawlSpeed = (2 * crawl) / CRAWL_MS;
    const legs: Leg[] = [
      approach(mod(target(stop) - crawl - angle, 360), velocity, crawlSpeed),
      { distance: crawl, duration: CRAWL_MS, ease: easeOut(2), onStart: () => startTension(level) },
    ];
    // Frozen where the crawl stopped while the button asks for taps.
    if (landing.variant === "renda")
      legs.push({ distance: 0, duration: RENDA_MS, ease: still, onStart: () => startRenda(level) });
    if (landing.variant === "push")
      legs.push(
        { distance: 0, duration: HUSH_MS, ease: still, onStart: hush },
        {
          distance: 0,
          duration: PUSH_WAIT_MS,
          ease: still,
          wait: true,
          onStart: () => askPush(level),
        },
      );
    if (landing.fakeStop)
      legs.push(
        {
          distance: mod(target(landing) - target(landing.fakeStop), 360),
          duration: JOLT_MS,
          ease: backOut,
          onStart: jolt,
        },
        { distance: 0, duration: JOLT_HOLD_MS, ease: still },
      );
    return legs;
  };

  const startCharge = () => {
    if (phase !== "idle") return;
    const m = motion.current;
    m.base = m.angle;
    m.level = 0;
    let steps = 0;
    const start = performance.now();
    setPhase("charge");
    const loop = (now: number) => {
      const level = Math.min((now - start) / CHARGE_MS, 1);
      m.level = level;
      const step = Math.floor(level * 10);
      if (step > steps) {
        steps = step;
        sfx.ratchet(level);
        vibrate(8);
      }
      // The more charge, the further the wheel winds back.
      if (!reducedMotion()) setAngle(m.base - 32 * (1 - (1 - level) ** 2));
      setCharge(level);
      if (level < 1) m.frame = requestAnimationFrame(loop);
    };
    m.frame = requestAnimationFrame(loop);
  };

  const cancelCharge = () => {
    if (phase !== "charge") return;
    const m = motion.current;
    cancelAnimationFrame(m.frame);
    setAngle(m.base);
    setCharge(0);
    setPhase("idle");
  };

  /** Start spinning. Returns false when a spin is already under way. */
  const release = () => {
    if (phase !== "idle" && phase !== "charge") return false;
    const m = motion.current;
    cancelAnimationFrame(m.frame);
    const top = 1.5 + 0.8 * (phase === "charge" ? m.level : 0); // degrees per ms
    m.velocity = 0;
    m.pending = null;
    m.course = null;
    setCharge(0);
    setHighlight(undefined);
    setResult(null);
    setNearMiss(false);
    setCutIn(null);
    endPrompt();
    setPhase("spinning");
    if (reducedMotion()) return true;
    let boundary = Math.floor(m.angle / seg);
    let last = performance.now();
    m.freeSince = last;
    const done = (leg: Leg, elapsed: number) =>
      elapsed >= leg.duration || (leg.wait === true && m.pushed);
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const before = m.angle;
      const course = m.course;
      if (course) {
        let leg = course.legs[course.at];
        let elapsed = now - course.start;
        while (leg && done(leg, elapsed) && course.at < course.legs.length - 1) {
          course.from += leg.distance;
          course.start = leg.wait ? now : course.start + leg.duration;
          course.at += 1;
          leg = course.legs[course.at];
          leg?.onStart?.();
          elapsed = now - course.start;
        }
        if (leg)
          setAngle(course.from + leg.distance * leg.ease(Math.min(elapsed / leg.duration, 1)));
        if (!leg || done(leg, elapsed)) {
          m.timer = window.setTimeout(() => reveal(course.landing), REVEAL_DELAY_MS);
          return;
        }
      } else {
        m.velocity = top * Math.min(1, (now - m.freeSince) / RAMP_MS);
        setAngle(m.angle + m.velocity * dt);
        if (m.pending && now - m.freeSince >= MIN_FREE_MS) {
          const legs = legsFor(m.pending, m.angle, m.velocity);
          m.course = { landing: m.pending, legs, at: 0, from: m.angle, start: now };
          m.pending = null;
          legs[0]?.onStart?.();
        }
      }
      const next = Math.floor(m.angle / seg);
      if (next !== boundary) {
        boundary = next;
        sfx.tick(m.tense);
        flickPointer(pointerRef.current);
        const speed = dt > 0 ? Math.abs(m.angle - before) / dt : 0;
        if (m.tense) vibrate(18);
        else if (speed < SLOW) vibrate(6);
      }
      m.frame = requestAnimationFrame(loop);
    };
    m.frame = requestAnimationFrame(loop);
    return true;
  };

  const settle = (landing: Landing) => {
    const m = motion.current;
    if (m.pending || m.course) return;
    if (reducedMotion()) {
      setAngle(rotationFor(landing.index, count, landing.fraction));
      reveal(landing);
      return;
    }
    m.pending = landing;
  };

  /** The server picked `drawn`: slow down onto one of its slices and reveal it. */
  const land = (drawn: DrawResult) => {
    settle({ result: drawn, ...planLanding(segments, drawn, Math.random, demoForce()) });
  };

  /** The spin failed: slow down anywhere and go back to idle. */
  const abort = () => {
    settle({ result: null, ...planLanding(segments, null, Math.random) });
  };

  return {
    phase,
    charge,
    rotation,
    highlight,
    result,
    celebrateKey,
    staging,
    cutIn,
    prompt,
    gauge,
    taps,
    pushKey,
    nearMiss,
    wheelRef,
    pointerRef,
    stageRef,
    startCharge,
    cancelCharge,
    release,
    press,
    land,
    abort,
  };
}
