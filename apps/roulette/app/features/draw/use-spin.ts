import { useEffect, useRef, useState } from "react";
import { type Segment, mod, rotationFor } from "~/features/prizes/odds";
import { flickPointer } from "./components/Wheel";
import { reducedMotion, revealVibration, sfx, vibrate } from "./feedback";
import type { DrawResult } from "./result";

export type SpinPhase = "idle" | "charge" | "spinning" | "result";

const CHARGE_MS = 1200;
/** Free spin reaches full speed in this long. */
const RAMP_MS = 180;
/** Spin freely at least this long before slowing down, even when the server is fast. */
const MIN_FREE_MS = 450;
/** Aim for a slow-down of about this long. */
const LAND_MS = 3600;
/** Pause between stopping and the reveal. */
const REVEAL_DELAY_MS = 300;

type Landing = { result: DrawResult | null; index: number; fraction: number };

/** Where the wheel rests for a past result: that prize's first slice under the pointer. */
export function restingOn(segments: Segment[], prizeId: string | null) {
  const index = segments.findIndex((segment) => segment.prizeId === prizeId);
  if (index < 0) return { rotation: 0, highlight: undefined };
  return { rotation: rotationFor(index, segments.length), highlight: index };
}

/**
 * Drives the wheel: hold to charge (the wheel winds back), release to spin
 * freely while the server picks the prize, then `land()` eases into the
 * winning slice with no jump in speed and reveals the result. The wheel's
 * transform is set directly each frame; React state only changes per phase.
 */
export function useSpin(segments: Segment[], initial: { rotation: number; highlight?: number }) {
  const [phase, setPhase] = useState<SpinPhase>("idle");
  const [charge, setCharge] = useState(0);
  const [rotation, setRotation] = useState(initial.rotation);
  const [highlight, setHighlight] = useState(initial.highlight);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [celebrateKey, setCelebrateKey] = useState(0);
  const wheelRef = useRef<SVGGElement>(null);
  const pointerRef = useRef<SVGGElement>(null);
  const motion = useRef({
    angle: initial.rotation,
    base: initial.rotation,
    level: 0,
    velocity: 0,
    frame: 0,
    timer: 0,
    freeSince: 0,
    pending: null as Landing | null,
    landing: null as
      | (Landing & { from: number; distance: number; duration: number; start: number })
      | null,
  });
  const count = Math.max(segments.length, 1);

  useEffect(
    () => () => {
      cancelAnimationFrame(motion.current.frame);
      clearTimeout(motion.current.timer);
    },
    [],
  );

  const setAngle = (angle: number) => {
    motion.current.angle = angle;
    wheelRef.current?.setAttribute("transform", `rotate(${angle})`);
  };

  const reveal = (landing: Landing) => {
    const m = motion.current;
    m.landing = null;
    m.pending = null;
    setRotation(m.angle);
    if (!landing.result) {
      setPhase("idle");
      return;
    }
    const drawn = landing.result;
    setHighlight(landing.index);
    setResult(drawn);
    setPhase("result");
    setCelebrateKey((key) => key + 1);
    sfx.reveal(drawn.tier);
    vibrate(revealVibration[drawn.tier]);
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
    m.landing = null;
    setCharge(0);
    setHighlight(undefined);
    setResult(null);
    setPhase("spinning");
    if (reducedMotion()) return true;
    const seg = 360 / count;
    let boundary = Math.floor(m.angle / seg);
    let last = performance.now();
    m.freeSince = last;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const landing = m.landing;
      if (landing) {
        const t = Math.min((now - landing.start) / landing.duration, 1);
        setAngle(landing.from + landing.distance * (1 - (1 - t) ** 4));
        if (t >= 1) {
          m.timer = window.setTimeout(() => reveal(landing), REVEAL_DELAY_MS);
          return;
        }
      } else {
        m.velocity = top * Math.min(1, (now - m.freeSince) / RAMP_MS);
        setAngle(m.angle + m.velocity * dt);
        if (m.pending && now - m.freeSince >= MIN_FREE_MS) {
          // Ease out (1 − (1 − t)⁴) starts at 4·distance/duration: match the current speed.
          const target = rotationFor(m.pending.index, count, m.pending.fraction);
          const delta = mod(target - m.angle, 360);
          const turns = Math.max(1, Math.round((m.velocity * LAND_MS) / 4 / 360 - delta / 360));
          const distance = turns * 360 + delta;
          m.landing = {
            ...m.pending,
            from: m.angle,
            distance,
            duration: (4 * distance) / m.velocity,
            start: now,
          };
          m.pending = null;
        }
      }
      const next = Math.floor(m.angle / seg);
      if (next !== boundary) {
        boundary = next;
        sfx.tick();
        flickPointer(pointerRef.current);
      }
      m.frame = requestAnimationFrame(loop);
    };
    m.frame = requestAnimationFrame(loop);
    return true;
  };

  const settle = (landing: Landing) => {
    const m = motion.current;
    if (m.pending || m.landing) return;
    if (reducedMotion()) {
      setAngle(rotationFor(landing.index, count, landing.fraction));
      reveal(landing);
      return;
    }
    m.pending = landing;
  };

  /** The server picked `drawn`: slow down onto one of its slices and reveal it. */
  const land = (drawn: DrawResult) => {
    const matches = segments.flatMap((segment, i) =>
      segment.prizeId === drawn.prizeId ? [i] : [],
    );
    const index =
      matches[Math.floor(Math.random() * matches.length)] ?? Math.floor(Math.random() * count);
    settle({ result: drawn, index, fraction: 0.15 + Math.random() * 0.7 });
  };

  /** The spin failed: slow down anywhere and go back to idle. */
  const abort = () => {
    settle({ result: null, index: Math.floor(Math.random() * count), fraction: 0.5 });
  };

  return {
    phase,
    charge,
    rotation,
    highlight,
    result,
    celebrateKey,
    wheelRef,
    pointerRef,
    startCharge,
    cancelCharge,
    release,
    land,
    abort,
  };
}
