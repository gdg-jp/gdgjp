import { useSyncExternalStore } from "react";

type TickFn = (now: number) => void;
const tickers = new Set<TickFn>();
let raf = 0;

function loop(now: number) {
  for (const fn of tickers) fn(now);
  raf = tickers.size > 0 ? requestAnimationFrame(loop) : 0;
}

export function onFrame(fn: TickFn): () => void {
  tickers.add(fn);
  if (!raf && typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(loop);
  return () => {
    tickers.delete(fn);
  };
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
