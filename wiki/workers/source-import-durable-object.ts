import { DurableObject } from "cloudflare:workers";
import { ensureSourceImportDoSchema } from "./features/sources/import/do-store";
import {
  ALARM_CONTINUE_MS,
  type SourceImportClaimRequest,
  claimSourceImport,
  failSourceImportRun,
  releaseSourceImportClaim,
  retryAlarmDelayMs,
} from "./features/sources/import/run";
import { advanceSourceImportTick } from "./features/sources/import/tick";
import { SUBREQUEST_BUDGET_LIMIT, SubrequestBudget } from "./features/sources/subrequest-budget";

const RUN_ID_KEY = "runId";

/**
 * One instance per source (`idFromName(sourceId)`).
 * Continuations are alarm self-chains — no queue ops after start().
 */
export class SourceImportDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ensureSourceImportDoSchema(this.ctx.storage.sql);
    });
  }

  /** Serialize the D1 claim and object-storage reset for this source. */
  async start(request: SourceImportClaimRequest): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const claimed = await claimSourceImport(this.env, request);
      if (!claimed) return false;
      try {
        await this.ctx.storage.deleteAll();
        ensureSourceImportDoSchema(this.ctx.storage.sql);
        await this.ctx.storage.put(RUN_ID_KEY, claimed.runId);
        await this.ctx.storage.setAlarm(Date.now());
      } catch (error) {
        await releaseSourceImportClaim(
          this.env,
          claimed.sourceId,
          request.fetchAttemptId,
          claimed.runId,
        );
        throw error;
      }
      console.log(
        JSON.stringify({
          component: "sources",
          event: "import_started",
          sourceId: claimed.sourceId,
          runId: claimed.runId,
          kind: claimed.kind,
          incremental: Boolean(claimed.sinceCursor),
          subrequestBudget: SUBREQUEST_BUDGET_LIMIT,
        }),
      );
      return true;
    });
  }

  async alarm(): Promise<void> {
    const runId = await this.ctx.storage.get<string>(RUN_ID_KEY);
    if (!runId) return;

    const startedAt = Date.now();
    const budget = new SubrequestBudget();
    try {
      const result = await advanceSourceImportTick({
        env: this.env,
        sql: this.ctx.storage.sql,
        budget,
        runId,
      });
      console.log(
        JSON.stringify({
          component: "sources",
          integration: "source-import",
          event: "import_tick",
          runId,
          phase: result.phase,
          finished: result.finished,
          subrequests: result.subrequests,
          wallMs: Date.now() - startedAt,
        }),
      );
      if (result.finished) {
        await this.ctx.storage.deleteAll();
        return;
      }
      await this.ctx.storage.setAlarm(Date.now() + (result.continueAfterMs ?? ALARM_CONTINUE_MS));
    } catch (error) {
      const outcome = await failSourceImportRun(this.env, runId, error);
      console.error(
        JSON.stringify({
          component: "sources",
          integration: "source-import",
          event: "import_tick_failed",
          runId,
          retryable: outcome.retryable,
          consecutiveFailures: outcome.consecutiveFailures,
          subrequests: budget.spent,
          wallMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (outcome.retryable) {
        await this.ctx.storage.setAlarm(
          Date.now() + retryAlarmDelayMs(outcome.consecutiveFailures),
        );
        return;
      }
      await this.ctx.storage.deleteAll();
    }
  }
}
