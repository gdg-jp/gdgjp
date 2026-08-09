import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_PARALLELISM,
  SUBREQUEST_BUDGET_LIMIT,
  SubrequestBudget,
} from "./subrequest-budget";

describe("SubrequestBudget", () => {
  it("allows spending up to the soft limit and refuses the next unit", () => {
    const budget = new SubrequestBudget(5);
    expect(budget.canSpend(5)).toBe(true);
    budget.spend(4);
    expect(budget.canSpend(2)).toBe(false);
    expect(budget.canSpend(1)).toBe(true);
    budget.spend(1);
    expect(budget.remaining()).toBe(0);
    expect(() => budget.spend(1)).toThrow(/budget exceeded/);
  });

  it("defaults to the production soft cap under Workers Free's 50 limit", () => {
    expect(SUBREQUEST_BUDGET_LIMIT).toBe(40);
    expect(ATTACHMENT_PARALLELISM).toBe(4);
    expect(ATTACHMENT_PARALLELISM).toBeLessThanOrEqual(6);
  });
});
