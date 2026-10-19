import { useEffect, useState } from "react";
import type { Timer } from "./protocol";
import { timerRemaining } from "./room-state";

/** "12:34", or "+01:23" once overrun. */
export function formatRemaining(ms: number): string {
  const over = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000) + (over ? 0 : ms % 1000 > 0 ? 1 : 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${over ? "+" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Remaining ms on the stage timer, corrected for server clock offset. */
export function useRemaining(timer: Timer | undefined, clockOffset: number): number | null {
  const now = useNow();
  if (!timer) return null;
  return timerRemaining(timer, now + clockOffset);
}
