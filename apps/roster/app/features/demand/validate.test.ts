import { describe, expect, it } from "vitest";
import {
  DEMAND_VALIDATION_MESSAGES,
  firstDemandValidationMessage,
  isValidDemand,
  validateDemand,
} from "./validate";

const VALID = { min: 3, ideal: 4, leadMin: 1, newMax: 2 };

describe("validateDemand", () => {
  it("accepts a value that satisfies every invariant", () => {
    expect(validateDemand(VALID)).toEqual([]);
    expect(isValidDemand(VALID)).toBe(true);
  });

  it("accepts the all-zero 'no demand' value", () => {
    expect(validateDemand({ min: 0, ideal: 0, leadMin: 0, newMax: 0 })).toEqual([]);
  });

  /**
   * docs/roster/03-demand-input.md "回帰として固定すべきテスト": rejecting
   * this is the single highest-leverage check in this feature — an unmet
   * leadMin would sit at rank 1 of the solver's scarcity ordering forever
   * (docs/roster/index.md §5.2) and silently degrade every other slot's
   * fill order. It must never reach D1.
   */
  it("rejects leadMin > ideal", () => {
    const errors = validateDemand({ min: 0, ideal: 2, leadMin: 3, newMax: 5 });
    expect(errors).toContain("LEAD_MIN_EXCEEDS_IDEAL");
    expect(isValidDemand({ min: 0, ideal: 2, leadMin: 3, newMax: 5 })).toBe(false);
  });

  it("accepts leadMin === ideal (the boundary is inclusive)", () => {
    expect(validateDemand({ min: 0, ideal: 2, leadMin: 2, newMax: 5 })).toEqual([]);
  });

  it("rejects min > ideal", () => {
    expect(validateDemand({ min: 5, ideal: 2, leadMin: 0, newMax: 5 })).toContain(
      "MIN_EXCEEDS_IDEAL",
    );
  });

  it("rejects negative min, leadMin, newMax", () => {
    expect(validateDemand({ min: -1, ideal: 2, leadMin: 0, newMax: 5 })).toContain("MIN_NEGATIVE");
    expect(validateDemand({ min: 0, ideal: 2, leadMin: -1, newMax: 5 })).toContain(
      "LEAD_MIN_NEGATIVE",
    );
    expect(validateDemand({ min: 0, ideal: 2, leadMin: 0, newMax: -1 })).toContain(
      "NEW_MAX_NEGATIVE",
    );
  });

  it("rejects ideal === 0 with a nonzero sibling field", () => {
    expect(validateDemand({ min: 1, ideal: 0, leadMin: 0, newMax: 0 })).toContain(
      "IDEAL_ZERO_REQUIRES_ZEROED_FIELDS",
    );
    expect(validateDemand({ min: 0, ideal: 0, leadMin: 1, newMax: 0 })).toContain(
      "IDEAL_ZERO_REQUIRES_ZEROED_FIELDS",
    );
    expect(validateDemand({ min: 0, ideal: 0, leadMin: 0, newMax: 1 })).toContain(
      "IDEAL_ZERO_REQUIRES_ZEROED_FIELDS",
    );
  });

  it("can report multiple violations at once", () => {
    const errors = validateDemand({ min: -1, ideal: 2, leadMin: 3, newMax: -1 });
    expect(errors).toEqual(
      expect.arrayContaining(["MIN_NEGATIVE", "LEAD_MIN_EXCEEDS_IDEAL", "NEW_MAX_NEGATIVE"]),
    );
  });
});

describe("firstDemandValidationMessage", () => {
  it("returns null for a valid value", () => {
    expect(firstDemandValidationMessage(VALID)).toBeNull();
  });

  it("returns the message for the first violated invariant", () => {
    const message = firstDemandValidationMessage({ min: 0, ideal: 2, leadMin: 3, newMax: 5 });
    expect(message).toBe(DEMAND_VALIDATION_MESSAGES.LEAD_MIN_EXCEEDS_IDEAL);
  });
});
