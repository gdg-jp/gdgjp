/** Soft cap under Workers Free's 50 subrequest limit (room for token refresh + D1). */
export const SUBREQUEST_BUDGET_LIMIT = 40;

/**
 * Max stylesheets per website capture (each costs fetch + R2 put).
 * Leaves the HTML fetch itself as `1 + MAX_STYLESHEETS * 2 <= SUBREQUEST_BUDGET_LIMIT`.
 */
export const MAX_WEBSITE_STYLESHEETS = Math.floor((SUBREQUEST_BUDGET_LIMIT - 1) / 2);

/** Max concurrent outgoing attachment downloads (Workers caps concurrent connects at 6). */
export const ATTACHMENT_PARALLELISM = 4;

/**
 * Counts every `fetch` / R2 / D1 call that shares the Workers subrequest budget.
 * Durable Object storage reads and writes do not consume this budget.
 */
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
