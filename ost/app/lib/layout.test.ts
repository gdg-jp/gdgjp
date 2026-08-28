import { describe, expect, it } from "vitest";
import { boundingBox, centersOverlap, fitTransform, pointInRotatedRect } from "./layout";
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
