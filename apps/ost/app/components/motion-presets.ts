import type { Transition, Variants } from "motion/react";

export const transitions: {
  spring: Transition;
  springSoft: Transition;
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

export const tap = { whileTap: { scale: 0.96 } } as const;
export const tapSubtle = { whileTap: { scale: 0.98 } } as const;

export const staggerDelay = (index: number): number => Math.min(index * 0.035, 0.4);
