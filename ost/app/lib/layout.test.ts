import { describe, expect, it } from "vitest";
import {
  angleFromCenter,
  boundingBox,
  centersOverlap,
  deskCorners,
  fitTransform,
  normalizeAngle,
  pointInRotatedRect,
  resizeDesk,
} from "./layout";
import type { Desk } from "./topics";

const desk = (over: Partial<Desk>): Desk => ({
  id: "d",
  label: "",
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  rotation: 0,
  sortOrder: 0,
  createdAt: 0,
  ...over,
});

describe("boundingBox", () => {
  it("is empty for no desks", () => {
    expect(boundingBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("wraps an axis-aligned desk exactly", () => {
    const box = boundingBox([desk({ x: 10, y: 20, width: 100, height: 60 })]);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo(60);
  });

  it("grows for a 90°-rotated desk (w/h swap)", () => {
    const box = boundingBox([desk({ x: 0, y: 0, width: 100, height: 60, rotation: 90 })]);
    expect(box.width).toBeCloseTo(60);
    expect(box.height).toBeCloseTo(100);
  });
});

describe("fitTransform", () => {
  it("scales a large world down to fit the viewport", () => {
    const t = fitTransform(
      { x: 0, y: 0, width: 2000, height: 1000 },
      { width: 1000, height: 1000 },
      0,
    );
    expect(t.scale).toBeCloseTo(0.5);
  });

  it("never scales up past 1", () => {
    const t = fitTransform(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 1000, height: 1000 },
      0,
    );
    expect(t.scale).toBe(1);
  });
});

describe("pointInRotatedRect", () => {
  it("detects inside and outside", () => {
    const d = desk({ x: 0, y: 0, width: 100, height: 60 });
    expect(pointInRotatedRect({ x: 50, y: 30 }, d)).toBe(true);
    expect(pointInRotatedRect({ x: 200, y: 30 }, d)).toBe(false);
  });
});

describe("angleFromCenter", () => {
  const center = { x: 100, y: 100 };

  it("is 0 for a point straight above the center", () => {
    expect(angleFromCenter(center, { x: 100, y: 0 })).toBeCloseTo(0);
  });

  it("is 90 for a point straight right of the center", () => {
    expect(angleFromCenter(center, { x: 200, y: 100 })).toBeCloseTo(90);
  });

  it("is 180 (or -180) for a point straight below the center", () => {
    const ang = angleFromCenter(center, { x: 100, y: 200 });
    expect(Math.abs(ang)).toBeCloseTo(180);
  });
});

describe("normalizeAngle", () => {
  it("leaves in-range angles untouched", () => {
    expect(normalizeAngle(90)).toBeCloseTo(90);
    expect(normalizeAngle(-90)).toBeCloseTo(-90);
    expect(normalizeAngle(180)).toBeCloseTo(180);
  });

  it("wraps angles past 180 to negative", () => {
    expect(normalizeAngle(190)).toBeCloseTo(-170);
  });

  it("wraps angles past -180 to positive", () => {
    expect(normalizeAngle(-190)).toBeCloseTo(170);
  });
});

describe("resizeDesk", () => {
  it("grows width/height by the screen delta at scale 1 without moving x/y", () => {
    const start = desk({ x: 10, y: 20, width: 100, height: 60, rotation: 0 });
    const result = resizeDesk(start, 40, 20, { scale: 1 });
    expect(result.width).toBeCloseTo(140);
    expect(result.height).toBeCloseTo(80);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
  });

  it("divides the screen delta by scale (regression: was growing ~2x)", () => {
    const start = desk({ x: 0, y: 0, width: 100, height: 60, rotation: 0 });
    const result = resizeDesk(start, 40, 20, { scale: 0.5 });
    expect(result.width).toBeCloseTo(180);
    expect(result.height).toBeCloseTo(100);
  });

  it("clamps to the minimum footprint", () => {
    const start = desk({ x: 0, y: 0, width: 100, height: 60, rotation: 0 });
    const result = resizeDesk(start, -1000, -1000, { scale: 1 });
    expect(result.width).toBe(60);
    expect(result.height).toBe(40);
  });

  it("projects the delta onto the desk's local axes when rotated", () => {
    const start = desk({ x: 0, y: 0, width: 100, height: 60, rotation: 90 });
    // A 90°-rotated desk's local "width" axis points along screen +y.
    const result = resizeDesk(start, 0, 40, { scale: 1 });
    expect(result.width).toBeCloseTo(140);
    expect(result.height).toBeCloseTo(60);
  });

  it("keeps the local top-left corner fixed across a rotated resize", () => {
    const start = desk({ x: 0, y: 0, width: 100, height: 60, rotation: 30 });
    const before = deskCorners(start)[0];
    const patch = resizeDesk(start, 25, -15, { scale: 1 });
    const after = deskCorners({ ...start, ...patch })[0];
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});

describe("centersOverlap", () => {
  it("is true when a's centre falls inside b", () => {
    expect(
      centersOverlap(
        { x: 40, y: 40, width: 20, height: 20 },
        { x: 0, y: 0, width: 100, height: 100 },
      ),
    ).toBe(true);
  });
  it("is false otherwise", () => {
    expect(
      centersOverlap(
        { x: 400, y: 400, width: 20, height: 20 },
        { x: 0, y: 0, width: 100, height: 100 },
      ),
    ).toBe(false);
  });
});
