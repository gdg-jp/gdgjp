import { useEffect, useRef } from "react";
import { formatRemaining, formatTime } from "~/features/clips/transcript";
import { onFrame } from "~/lib/frame";

type Props = {
  durationMs: number;
  getMs: (now: number) => number;
  live: boolean;
  className?: string;
};

export function RemainingTime({ durationMs, getMs, live, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const getMsRef = useRef(getMs);
  getMsRef.current = getMs;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!live) {
      el.textContent = formatTime(durationMs);
      return;
    }
    let last = "";
    return onFrame((now) => {
      const text = formatRemaining(durationMs, getMsRef.current(now));
      if (text !== last) {
        last = text;
        el.textContent = text;
      }
    });
  }, [durationMs, live]);

  return (
    <span ref={ref} className={className}>
      {formatTime(durationMs)}
    </span>
  );
}
