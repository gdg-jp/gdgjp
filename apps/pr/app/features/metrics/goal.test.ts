import { describe, expect, it } from "vitest";
import { goalAt, goalStatus } from "./goal";

const curve = [
  { date: "2026-09-01", applications: 100 },
  { date: "2026-10-01", applications: 400 },
];

describe("goal curve", () => {
  it("interpolates between points", () => {
    expect(goalAt(curve, "2026-09-16")).toBe(250);
    expect(goalAt(curve, "2026-08-01")).toBe(100);
    expect(goalAt(curve, "2026-12-01")).toBe(400);
  });
  it("says how far ahead or behind, and what each remaining day needs", () => {
    expect(
      goalStatus({
        curve,
        goal: 800,
        today: "2026-09-16",
        eventDate: "2026-10-18",
        applications: 200,
      }),
    ).toEqual({
      expected: 250,
      diff: -50,
      daysLeft: 32,
      perDayNeeded: 19,
    });
  });
});
