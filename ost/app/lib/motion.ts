import type { Transition, Variants } from "motion/react";

/**
 * Shared motion presets for OST. Animations here are functional (dialog
 * open/close, button feedback, list reordering, state changes) — not
 * decorative. Every consumer runs under `<MotionConfig reducedMotion="user">`
 * (see `app/root.tsx`), so `prefers-reduced-motion` is honoured automatically.
 */

export const transitions: {
  /** Crisp — dialogs, pop-ins, taps. */
  spring: Transition;
  /** Softer — FLIP list reordering. */
  springSoft: Transition;
  /** Plain fades. */
  fade: Transition;
} = {
  spring: { type: "spring", stiffness: 380, damping: 32 },
  springSoft: { type: "spring", stiffness: 260, damping: 30 },
  fade: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
};

export const fade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const pop: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 8 },
};

export const listItem: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12 } },
};

/** Spread onto a `motion.button` for press feedback. */
export const tap = { whileTap: { scale: 0.96 } } as const;
export const tapSubtle = { whileTap: { scale: 0.98 } } as const;

/** Capped per-item entrance delay so long lists don't cascade forever. */
export const staggerDelay = (index: number): number => Math.min(index * 0.035, 0.4);
