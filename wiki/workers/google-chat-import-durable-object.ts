import { DurableObject } from "cloudflare:workers";
import {
  ALARM_CONTINUE_MS,
  advanceChatImportTick,
  failChatImportRun,
  retryAlarmDelayMs,
} from "./features/sources/google-chat-import";
import { ensureChatImportDoSchema } from "./features/sources/google-chat-import-do-store";
import { SubrequestBudget } from "./features/sources/subrequest-budget";

const RUN_ID_KEY = "runId";

/**
 * One instance per Google Chat source (`idFromName(sourceId)`).
 * Continuations are alarm self-chains — no queue ops after start().
 */
export class GoogleChatImportDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ensureChatImportDoSchema(this.ctx.storage.sql);
    });
  }

  /** Begin (or replace) an import run for this source. */
  async start(runId: string): Promise<void> {
    await this.ctx.storage.deleteAll();
    ensureChatImportDoSchema(this.ctx.storage.sql);
    await this.ctx.storage.put(RUN_ID_KEY, runId);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const runId = await this.ctx.storage.get<string>(RUN_ID_KEY);
    if (!runId) return;

    const startedAt = Date.now();
    const budget = new SubrequestBudget();
    try {
      const result = await advanceChatImportTick({
        env: this.env,
        sql: this.ctx.storage.sql,
        budget,
        runId,
      });
      console.log(
        JSON.stringify({
          component: "sources",
          integration: "google-chat",
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
      await this.ctx.storage.setAlarm(Date.now() + ALARM_CONTINUE_MS);
    } catch (error) {
      const outcome = await failChatImportRun(this.env, runId, error);
      console.error(
        JSON.stringify({
          component: "sources",
          integration: "google-chat",
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
