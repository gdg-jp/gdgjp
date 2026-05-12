import { describe, expect, it } from "vitest";
import { reconcileSlotKeys } from "./db";

describe("reconcileSlotKeys", () => {
  it("classifies kept, inserted, and removed slots by (day, time)", () => {
    const existing = [
      { dayOfWeek: 0, startTime: "19:00" },
      { dayOfWeek: 0, startTime: "20:00" },
      { dayOfWeek: 2, startTime: "10:00" },
    ];
    const next = [
      { dayOfWeek: 0, startTime: "19:00" },
      { dayOfWeek: 2, startTime: "10:00" },
      { dayOfWeek: 4, startTime: "09:00" },
    ];
    const r = reconcileSlotKeys(existing, next);
    expect(r.keep.sort()).toEqual(["0-19:00", "2-10:00"]);
    expect(r.insert).toEqual(["4-09:00"]);
    expect(r.remove).toEqual(["0-20:00"]);
  });

  it("returns empty arrays when nothing changes", () => {
    const slots = [{ dayOfWeek: 1, startTime: "12:00" }];
    const r = reconcileSlotKeys(slots, slots);
    expect(r.keep).toEqual(["1-12:00"]);
    expect(r.insert).toEqual([]);
    expect(r.remove).toEqual([]);
  });

  it("treats empty existing as all inserts", () => {
    const next = [{ dayOfWeek: 0, startTime: "09:00" }];
    expect(reconcileSlotKeys([], next).insert).toEqual(["0-09:00"]);
  });
});
