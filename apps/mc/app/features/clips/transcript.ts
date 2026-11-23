import type { Segment } from "./catalog";

export function charOffsetAt(segments: Segment[], ms: number): number {
  let offset = 0;
  for (const seg of segments) {
    const len = [...seg.t].length;
    if (ms < seg.s) return offset;
    if (ms < seg.e) {
      const span = Math.max(1, seg.e - seg.s);
      return offset + (len * (ms - seg.s)) / span;
    }
    offset += len;
  }
  return offset;
}

export function marqueeOffset(params: {
  caretX: number;
  textWidth: number;
  viewWidth: number;
  progress: number;
}): number {
  const { caretX, textWidth, viewWidth, progress } = params;
  const overflow = textWidth - viewWidth;
  if (overflow <= 0) return 0;
  const p = Math.min(1, Math.max(0, progress));
  const ideal = caretX - viewWidth * p;
  return -Math.min(overflow, Math.max(0, ideal));
}

export function formatRemaining(durationMs: number, positionMs: number): string {
  const left = Math.max(0, durationMs - positionMs);
  return formatTime(Math.ceil(left / 1000) * 1000);
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
