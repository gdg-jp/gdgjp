/** Soft cap under Workers Free's 50 subrequest limit (room for token refresh + D1). */
export const SUBREQUEST_BUDGET_LIMIT = 40;

export const WEBSITE_CONTENT_TICK_OVERHEAD = 3;

export const MAX_WEBSITE_STYLESHEETS = Math.floor(
  (SUBREQUEST_BUDGET_LIMIT - WEBSITE_CONTENT_TICK_OVERHEAD - 1) / 2,
);

export const ATTACHMENT_PARALLELISM = 4;

export class SubrequestBudget {
  spent = 0;

  constructor(readonly limit: number = SUBREQUEST_BUDGET_LIMIT) {}

  remaining(): number {
    return Math.max(0, this.limit - this.spent);
  }

  canSpend(n: number): boolean {
    return this.spent + n <= this.limit;
  }

  spend(n: number): void {
    if (n < 0) throw new Error("subrequest spend must be non-negative");
    if (!this.canSpend(n)) {
      throw new Error(`subrequest budget exceeded: need ${n}, remaining ${this.remaining()}`);
    }
    this.spent += n;
  }
}
