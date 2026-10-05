import { describe, expect, it } from "vitest";
import { buildSlots, toHHMM, toMin } from "./slots";

describe("toMin / toHHMM", () => {
  it("round-trips HH:MM <-> minutes", () => {
    expect(toMin("09:30")).toBe(570);
    expect(toHHMM(570)).toBe("09:30");
    expect(toMin("00:00")).toBe(0);
    expect(toHHMM(0)).toBe("00:00");
  });
});

describe("buildSlots", () => {
  it("splits a range into stepMin-wide, 0-based contiguous slots", () => {
    const slots = buildSlots({ start: "09:00", end: "12:00", stepMin: 60 });
    expect(slots).toEqual([
      { idx: 0, start: "09:00", end: "10:00", phaseId: null },
      { idx: 1, start: "10:00", end: "11:00", phaseId: null },
      { idx: 2, start: "11:00", end: "12:00", phaseId: null },
    ]);
  });

  it("drops a trailing partial slot instead of overrunning `end` (docs/roster/02-domain-schema.md regression)", () => {
    // 09:00-10:40 at 30-min steps: 09:00,09:30,10:00 fit; 10:30-11:00 would
    // exceed 10:40, so it must not appear.
    const slots = buildSlots({ start: "09:00", end: "10:40", stepMin: 30 });
    expect(slots.map((s) => s.end)).toEqual(["09:30", "10:00", "10:30"]);
    expect(slots.every((s) => toMin(s.end) <= toMin("10:40"))).toBe(true);
  });

  it("returns no slots when the range is shorter than one step", () => {
    expect(buildSlots({ start: "09:00", end: "09:20", stepMin: 30 })).toEqual([]);
  });

  it("assigns the phase whose [from, to) contains the slot start", () => {
    const slots = buildSlots({ start: "09:00", end: "11:00", stepMin: 60 }, [
      { id: "p1", from: "09:00", to: "10:00" },
      { id: "p2", from: "10:00", to: "11:00" },
    ]);
    expect(slots.map((s) => s.phaseId)).toEqual(["p1", "p2"]);
  });

  it("leaves phaseId null for a gap between phases", () => {
    const slots = buildSlots({ start: "09:00", end: "12:00", stepMin: 60 }, [
      { id: "p1", from: "09:00", to: "10:00" },
      // gap: nothing covers 10:00-11:00
      { id: "p2", from: "11:00", to: "12:00" },
    ]);
    expect(slots.map((s) => s.phaseId)).toEqual(["p1", null, "p2"]);
  });

  it("leaves phaseId null for every slot when no phases are configured", () => {
    const slots = buildSlots({ start: "09:00", end: "10:00", stepMin: 60 });
    expect(slots.every((s) => s.phaseId === null)).toBe(true);
  });
});
