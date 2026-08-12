import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_PARALLELISM,
  MAX_WEBSITE_STYLESHEETS,
  SUBREQUEST_BUDGET_LIMIT,
  SubrequestBudget,
  WEBSITE_CONTENT_TICK_OVERHEAD,
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

  it("leaves room for website content fetch after tick overhead", () => {
    const fetchBudget = 1 + MAX_WEBSITE_STYLESHEETS * 2;
    expect(WEBSITE_CONTENT_TICK_OVERHEAD + fetchBudget).toBeLessThanOrEqual(
      SUBREQUEST_BUDGET_LIMIT,
    );
    const budget = new SubrequestBudget();
    budget.spend(WEBSITE_CONTENT_TICK_OVERHEAD);
    expect(budget.canSpend(fetchBudget)).toBe(true);
  });
});
