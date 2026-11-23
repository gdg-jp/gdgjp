import { describe, expect, it } from "vitest";
import type { Segment } from "./catalog";
import { charOffsetAt, formatRemaining, formatTime, marqueeOffset } from "./transcript";

const segments: Segment[] = [
  { s: 200, e: 1200, t: "皆さん、" },
  { s: 1500, e: 2500, t: "ようこそ。" },
];

describe("charOffsetAt", () => {
  it("is 0 before speech starts", () => {
    expect(charOffsetAt(segments, 0)).toBe(0);
  });

  it("interpolates linearly inside a segment", () => {
    expect(charOffsetAt(segments, 700)).toBe(2);
    expect(charOffsetAt(segments, 2000)).toBe(4 + 2.5);
  });

  it("holds at the boundary during a pause", () => {
    expect(charOffsetAt(segments, 1300)).toBe(4);
  });

  it("clamps to the total after the end", () => {
    expect(charOffsetAt(segments, 99_999)).toBe(9);
  });
});

describe("marqueeOffset", () => {
  it("does not move text that fits", () => {
    expect(marqueeOffset({ caretX: 50, textWidth: 100, viewWidth: 200, progress: 0.5 })).toBe(0);
  });

  it("starts flush left and ends flush right", () => {
    expect(marqueeOffset({ caretX: 0, textWidth: 1000, viewWidth: 200, progress: 0 })).toBe(-0);
    expect(marqueeOffset({ caretX: 1000, textWidth: 1000, viewWidth: 200, progress: 1 })).toBe(
      -800,
    );
  });

  it("keeps the caret inside the view mid-way", () => {
    const x = marqueeOffset({ caretX: 500, textWidth: 1000, viewWidth: 200, progress: 0.5 });
    expect(500 + x).toBeGreaterThanOrEqual(0);
    expect(500 + x).toBeLessThanOrEqual(200);
  });
});

describe("formatTime", () => {
  it("formats m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(74_200)).toBe("1:14");
  });
});

describe("formatRemaining", () => {
  it("counts down from the full length to 0:00", () => {
    expect(formatRemaining(52_000, 0)).toBe("0:52");
    expect(formatRemaining(52_000, 400)).toBe("0:52");
    expect(formatRemaining(52_000, 1000)).toBe("0:51");
    expect(formatRemaining(52_000, 51_500)).toBe("0:01");
    expect(formatRemaining(52_000, 52_000)).toBe("0:00");
    expect(formatRemaining(52_000, 60_000)).toBe("0:00");
  });
});
