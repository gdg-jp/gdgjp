import { useEffect, useRef } from "react";
import type { Segment } from "~/features/clips/catalog";
import { charOffsetAt, marqueeOffset } from "~/features/clips/transcript";
import { onFrame, usePrefersReducedMotion } from "~/lib/frame";
import { Smoother } from "./smoother";

type Props = {
  segments: Segment[];
  durationMs: number;
  getMs: (now: number) => number;
  className?: string;
};

export function ScrollingText({ segments, durationMs, getMs, className }: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const getMsRef = useRef(getMs);
  getMsRef.current = getMs;
  const reduced = usePrefersReducedMotion();
  const text = segments.map((s) => s.t).join("");

  useEffect(() => {
    const view = viewRef.current;
    const span = textRef.current;
    if (!view || !span) return;

    let edges: number[] = [];
    let viewWidth = 0;
    const measure = () => {
      const node = span.firstChild;
      viewWidth = view.clientWidth;
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        edges = [0];
        return;
      }
      const range = document.createRange();
      const base = span.getBoundingClientRect().left;
      const chars = [...(node.textContent ?? "")];
      const xs: number[] = [];
      let index = 0;
      for (const ch of chars) {
        range.setStart(node, index);
        range.setEnd(node, index + ch.length);
        xs.push(range.getBoundingClientRect().left - base);
        index += ch.length;
      }
      xs.push(span.scrollWidth);
      edges = xs;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    void document.fonts?.ready.then(measure);

    const smoother = new Smoother(Math.max(250, durationMs * 0.01));
    let last = performance.now();
    let lastShift = Number.POSITIVE_INFINITY;
    let lastCaret = Number.POSITIVE_INFINITY;
    const stop = onFrame((now) => {
      const dt = now - last;
      last = now;
      const ms = smoother.step(getMsRef.current(now), dt, reduced);
      const offset = charOffsetAt(segments, ms);
      const i = Math.min(edges.length - 1, Math.floor(offset));
      const frac = offset - i;
      const x0 = edges[i] ?? 0;
      const x1 = edges[i + 1] ?? x0;
      const caretX = x0 + (x1 - x0) * frac;
      const textWidth = edges[edges.length - 1] ?? 0;
      const shift = marqueeOffset({
        caretX,
        textWidth,
        viewWidth,
        progress: durationMs > 0 ? ms / durationMs : 0,
      });
      if (Math.abs(shift - lastShift) > 0.1) {
        lastShift = shift;
        span.style.transform = `translate3d(${shift.toFixed(2)}px,0,0)`;
      }
      if (Math.abs(caretX - lastCaret) > 0.1) {
        lastCaret = caretX;
        span.style.setProperty("--caret", `${caretX.toFixed(2)}px`);
      }
    });
    return () => {
      stop();
      ro.disconnect();
    };
  }, [segments, durationMs, reduced]);

  return (
    <div ref={viewRef} className={`mc-marquee ${className ?? ""}`}>
      <span ref={textRef} className="mc-marquee-text">
        {text}
      </span>
    </div>
  );
}
