import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useMemo } from "react";
import { transitions } from "~/lib/motion";

/**
 * An integer that pops when it changes (e.g. a vote tally). Renders a single
 * text node — no duplicated/overlaid copies — so `getByText` matching and
 * screen readers see exactly the current value.
 */
export function AnimatedCount({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return <span className={className}>{value}</span>;
  }
  return (
    <motion.span
      key={value}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`inline-block tabular-nums ${className ?? ""}`}
    >
      {value}
    </motion.span>
  );
}

const CONFETTI_COLORS = [
  "var(--color-gdg-blue)",
  "var(--color-gdg-red)",
  "var(--color-gdg-yellow)",
  "var(--color-gdg-green)",
];

/**
 * One-shot celebratory burst for the participant "送信しました" screen. Pure
 * transform/opacity, no dependency, no idle loop. Renders nothing when the
 * viewer prefers reduced motion.
 */
export function ConfettiBurst({ count = 18 }: { count?: number }) {
  const reduceMotion = useReducedMotion();
  const id = useId();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (360 / count) * i + (Math.random() * 28 - 14);
        const rad = (angle * Math.PI) / 180;
        const distance = 110 + Math.random() * 150;
        return {
          key: `${id}-${i}`,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          dx: Math.cos(rad) * distance,
          dy: Math.sin(rad) * distance + 36,
          rotate: Math.random() * 720 - 360,
          delay: Math.random() * 0.08,
          duration: 0.9 + Math.random() * 0.35,
          width: 6 + Math.random() * 6,
          height: 4 + Math.random() * 5,
        };
      }),
    [count, id],
  );

  if (reduceMotion) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      <div className="absolute left-1/2 top-1/2">
        {pieces.map((p) => (
          <motion.span
            key={p.key}
            className="absolute block rounded-[2px]"
            style={{ width: p.width, height: p.height, background: p.color }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
            animate={{ x: p.dx, y: p.dy, rotate: p.rotate, opacity: 0 }}
            transition={{ duration: p.duration, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The live/reconnecting pill shared by the projector routes. The dot colour
 * eases between states and the label crossfades — only on change, never a
 * continuous pulse.
 */
export function ConnectionPill({ connected }: { connected: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <span className="flex items-center gap-2 text-lg text-neutral-500">
      <motion.span
        className="inline-block size-3 rounded-full border border-black"
        animate={{
          backgroundColor: connected ? "var(--color-gdg-green)" : "var(--color-gdg-yellow)",
        }}
        transition={reduceMotion ? { duration: 0 } : transitions.fade}
      />
      <span className="relative inline-flex min-w-[4.5em]">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={connected ? "live" : "reconnecting"}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {connected ? "ライブ" : "再接続中…"}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
