import { useEffect, useRef, useState } from "react";
import { formatRemaining, formatTime } from "~/features/clips/transcript";
import { onFrame, usePrefersReducedMotion } from "~/lib/frame";
import { Smoother } from "./smoother";

type Props = {
  durationMs: number;
  getMs: (now: number) => number;
  onScrub: (ms: number | null) => void;
  onCommit: (ms: number) => void;
  active: boolean;
  label: string;
  showTimes?: boolean;
};

const KEY_STEP_MS = 5000;

export function SeekBar({ durationMs, getMs, onScrub, onCommit, active, label, showTimes }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const dragMs = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const getMsRef = useRef(getMs);
  getMsRef.current = getMs;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const smoother = new Smoother(Math.max(250, durationMs * 0.01));
    let last = performance.now();
    let lastSec = -1;
    return onFrame((now) => {
      const root = rootRef.current;
      if (!root) return;
      const dt = now - last;
      last = now;
      const target = dragMs.current ?? getMsRef.current(now);
      const ms = smoother.step(target, dt, reduced || dragMs.current !== null);
      const p = durationMs > 0 ? Math.min(1, Math.max(0, ms / durationMs)) : 0;
      root.style.setProperty("--p", p.toFixed(5));
      root.setAttribute("aria-valuenow", String(Math.round(ms / 1000)));
      const sec = Math.floor(ms / 1000);
      if (elapsedRef.current && sec !== lastSec) {
        lastSec = sec;
        elapsedRef.current.textContent = formatTime(ms);
        root.setAttribute("aria-valuetext", formatTime(ms));
      }
      if (remainingRef.current) {
        const left = formatRemaining(durationMs, ms);
        if (remainingRef.current.textContent !== left) remainingRef.current.textContent = left;
      }
    });
  }, [durationMs, reduced]);

  const msFromEvent = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const p = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return p * durationMs;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragMs.current = msFromEvent(e.clientX);
    setDragging(true);
    onScrub(dragMs.current);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMs.current === null) return;
    dragMs.current = msFromEvent(e.clientX);
    onScrub(dragMs.current);
  };
  const end = (commit: boolean) => {
    const ms = dragMs.current;
    dragMs.current = null;
    setDragging(false);
    onScrub(null);
    if (commit && ms !== null) onCommit(ms);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = getMsRef.current(performance.now());
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = current + KEY_STEP_MS;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = current - KEY_STEP_MS;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = durationMs;
    if (next === null) return;
    e.preventDefault();
    onCommit(Math.min(durationMs, Math.max(0, next)));
  };

  return (
    <div
      className="mc-seek"
      data-active={active || undefined}
      data-dragging={dragging || undefined}
    >
      {showTimes && (
        <span ref={elapsedRef} className="mc-seek-time">
          0:00
        </span>
      )}
      <div
        ref={rootRef}
        className="mc-seek-hit"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuenow={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(false)}
        onLostPointerCapture={() => dragMs.current !== null && end(true)}
        onKeyDown={onKeyDown}
      >
        <div ref={trackRef} className="mc-seek-track">
          <div className="mc-seek-fill" />
          <div className="mc-seek-thumb" />
        </div>
      </div>
      {showTimes && (
        <span ref={remainingRef} className="mc-seek-time">
          {formatTime(durationMs)}
        </span>
      )}
    </div>
  );
}
