import { describe, expect, it } from "vitest";
import { constants } from "~/features/playbook/playbook";
import { overrun, xIgSplit } from "./flight";

const day = 86400;
const flight = { plannedYen: 30000, actualYen: 0, startAt: 0, endAt: 10 * day };

describe("overrun", () => {
  it("fires above planned × (1 + ratio)", () => {
    expect(overrun({ ...flight, actualYen: 33000 }, 0.1, 11 * day)).toBeNull();
    expect(overrun({ ...flight, actualYen: 33001 }, 0.1, 11 * day)).toContain("予算超過");
  });
  it("fires when spending 1.5× faster than the plan so far", () => {
    expect(overrun({ ...flight, actualYen: 5000 }, 0.1, 1 * day)).toContain("消化が早すぎる");
    expect(overrun({ ...flight, actualYen: 5000 }, 0.1, 5 * day)).toBeNull();
  });
});

describe("xIgSplit", () => {
  it("checks the X share against the Playbook's range", () => {
    const range = constants.budget.xIgRatioRange;
    expect(
      xIgSplit(
        [
          { medium: "x_ads", plannedYen: 35, actualYen: null },
          { medium: "ig_ads", plannedYen: 65, actualYen: null },
        ],
        range,
        "plannedYen",
      ).inRange,
    ).toBe(true);
    expect(
      xIgSplit(
        [
          { medium: "x_ads", plannedYen: 60, actualYen: null },
          { medium: "ig_ads", plannedYen: 40, actualYen: null },
        ],
        range,
        "plannedYen",
      ).inRange,
    ).toBe(false);
  });
});
