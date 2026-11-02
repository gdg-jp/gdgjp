import { useEffect, useRef, useState } from "react";
import { type Segment, mod, rotationFor } from "~/features/prizes/odds";
import { flickPointer } from "./components/Wheel";
import {
  cutInVibration,
  heartbeatVibration,
  reducedMotion,
  revealVibration,
  reviveVibration,
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
/** The staged finish: crawling after a cut-in, and the hush before a revival. */
export type Staging = "none" | "reach" | "hush";
export type CutInKind = CutInLevel | "revive";

const CHARGE_MS = 1200;
/** Free spin reaches full speed in this long. */
const RAMP_MS = 180;
/** Spin freely at least this long before slowing down, even when the server is fast. */
const MIN_FREE_MS = 450;
/** Aim for a slow-down of about this long. */
const LAND_MS = 3600;
/** A reach slows to a crawl in about this long, then crawls CRAWL_SLICES slices in CRAWL_MS. */
const APPROACH_MS = 2400;
const CRAWL_SLICES = 2.4;
const CRAWL_MS = 3200;
/**
 * A revival goes quiet this long after its fake stop, jolts on in REVIVE_MS,
 * and holds until its cut-in has left before the reveal.
 */
const HUSH_MS = 1000;
const REVIVE_MS = 520;
const REVIVE_HOLD_MS = 500;
const HEARTBEAT_MS = 640;
/** Pause between stopping and the reveal. */
const REVEAL_DELAY_MS = 300;
/** Below this speed (degrees per ms), passing a slice boundary also vibrates. */
const SLOW = 0.35;

type Landing = LandingPlan & { result: DrawResult | null };

/** One stretch of the finish: `distance` degrees in `duration` ms along `ease`. */
type Leg = {
  distance: number;
  duration: number;
  ease: (t: number) => number;
  onStart?: () => void;
};

const easeOut = (power: number) => (t: number) => 1 - (1 - t) ** power;

/** Overshoots a little and settles back: the revival's jolt. */
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

/** Dev only: `?demo=revive-gold` (a variant and/or a level) forces a finish, to try each effect. */
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
 * staged reach when staging.ts says so. The wheel's transform is set directly
 * each frame; React state only changes per phase.
 */
export function useSpin(segments: Segment[], initial: { rotation: number; highlight?: number }) {
  const [phase, setPhase] = useState<SpinPhase>("idle");
  const [charge, setCharge] = useState(0);
  const [rotation, setRotation] = useState(initial.rotation);
  const [highlight, setHighlight] = useState(initial.highlight);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [staging, setStaging] = useState<Staging>("none");
  const [cutIn, setCutIn] = useState<{ kind: CutInKind; key: number } | null>(null);
  const [nearMiss, setNearMiss] = useState(false);
  const wheelRef = useRef<SVGGElement>(null);
  const pointerRef = useRef<SVGGElement>(null);
  /** Shaken by the cut-in, the revival and the jackpot. */
  const stageRef = useRef<HTMLDivElement>(null);
  const motion = useRef({
    angle: initial.rotation,
    base: initial.rotation,
    level: 0,
    velocity: 0,
    frame: 0,
    timer: 0,
    heartbeat: 0,
    cutIns: 0,
    /** Crawling through a reach: boundaries tick louder and vibrate. */
    reach: false,
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

  useEffect(
    () => () => {
      cancelAnimationFrame(motion.current.frame);
      clearTimeout(motion.current.timer);
      clearInterval(motion.current.heartbeat);
    },
    [],
  );

  const setAngle = (angle: number) => {
    motion.current.angle = angle;
    wheelRef.current?.setAttribute("transform", `rotate(${angle})`);
  };

  const showCutIn = (kind: CutInKind) => {
    motion.current.cutIns += 1;
    setCutIn({ kind, key: motion.current.cutIns });
  };

  const stopHeartbeat = () => clearInterval(motion.current.heartbeat);

  const startReach = (level: CutInLevel) => {
    const m = motion.current;
    m.reach = true;
    setStaging("reach");
    showCutIn(level);
    sfx.cutIn(level);
    vibrate(cutInVibration[level]);
    shake(stageRef.current, level === "gold" ? 12 : 7);
    stopHeartbeat();
    m.heartbeat = window.setInterval(() => {
      sfx.heartbeat();
      vibrate(heartbeatVibration);
    }, HEARTBEAT_MS);
  };

  const hush = () => {
    motion.current.reach = false;
    stopHeartbeat();
    setStaging("hush");
  };

  const revive = () => {
    motion.current.reach = true;
    setStaging("reach");
    showCutIn("revive");
    sfx.revive();
    vibrate(reviveVibration);
    shake(stageRef.current, 16);
  };

  const reveal = (landing: Landing) => {
    const m = motion.current;
    m.course = null;
    m.pending = null;
    m.reach = false;
    stopHeartbeat();
    setStaging("none");
    setRotation(m.angle);
    if (!landing.result) {
      setPhase("idle");
      return;
    }
    const drawn = landing.result;
    setHighlight(landing.index);
    setResult(drawn);
    setNearMiss(landing.variant === "fake");
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
      { distance: crawl, duration: CRAWL_MS, ease: easeOut(2), onStart: () => startReach(level) },
    ];
    if (landing.fakeStop)
      legs.push(
        { distance: 0, duration: HUSH_MS, ease: () => 0, onStart: hush },
        {
          distance: mod(target(landing) - target(landing.fakeStop), 360),
          duration: REVIVE_MS,
          ease: backOut,
          onStart: revive,
        },
        { distance: 0, duration: REVIVE_HOLD_MS, ease: () => 0 },
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
    setPhase("spinning");
    if (reducedMotion()) return true;
    let boundary = Math.floor(m.angle / seg);
    let last = performance.now();
    m.freeSince = last;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const before = m.angle;
      const course = m.course;
      if (course) {
        let leg = course.legs[course.at];
        let t = leg ? (now - course.start) / leg.duration : 1;
        while (leg && t >= 1 && course.at < course.legs.length - 1) {
          course.from += leg.distance;
          course.start += leg.duration;
          course.at += 1;
          leg = course.legs[course.at];
          leg?.onStart?.();
          t = leg ? (now - course.start) / leg.duration : 1;
        }
        t = Math.min(t, 1);
        if (leg) setAngle(course.from + leg.distance * leg.ease(t));
        if (t >= 1) {
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
        sfx.tick(m.reach);
        flickPointer(pointerRef.current);
        const speed = dt > 0 ? Math.abs(m.angle - before) / dt : 0;
        if (m.reach) vibrate(18);
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
    nearMiss,
    wheelRef,
    pointerRef,
    stageRef,
    startCharge,
    cancelCharge,
    release,
    land,
    abort,
  };
}
