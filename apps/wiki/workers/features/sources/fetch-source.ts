import { and, eq, ne } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { sourceKindSpec } from "../../../app/features/sources/kinds";
import { getDb } from "../../../app/lib/db.server";
import { startSourceImport } from "./import/run";
import { isRetryableFetchError } from "./retry-classification";

/** Hourly: scheduled refreshes (hourly / daily / weekly by age) and the synthesize sweep. */
export const SOURCE_REFRESH_CRON = "0 * * * *";
export const TASK_REMINDER_CRON = "0 15 * * *";
/** Nightly, JST 02:00: translate + consolidate jobs for the runner (off-peak quota). */
export const AGENT_NIGHTLY_CRON = "0 17 * * *";

export interface FetchSourceOutcome {
  status: "ready" | "skipped" | "error";
  /** False when retrying cannot change the result — a missing token, a bad URL, a 404. */
  retryable: boolean;
}

export { isRetryableFetchError };

/**
 * Queue delivery creates a durable source-import lease only. All fetching and
 * retries happen in the source-scoped Durable Object so large sources never
 * exhaust one Queue worker invocation's subrequest budget.
 */
export async function fetchSource(env: Env, sourceId: string): Promise<FetchSourceOutcome> {
  const db = getDb(env);
  const source = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (!source || source.status === "archived") {
    console.warn("[sources] fetch skipped; source missing or archived", sourceId);
    return { status: "skipped", retryable: false };
  }

  // A status alone is not a lease: delivery may have been interrupted between
  // claiming the source and inserting its run. Recover those orphaned claims.
  if (source.status === "fetching") {
    const activeRun = source.fetchAttemptId
      ? await db
          .select({ id: schema.sourceImportRuns.id })
          .from(schema.sourceImportRuns)
          .where(
            and(
              eq(schema.sourceImportRuns.sourceId, sourceId),
              eq(schema.sourceImportRuns.fetchAttemptId, source.fetchAttemptId),
            ),
          )
          .get()
      : null;
    if (activeRun) {
      console.warn("[sources] fetch skipped; source import already running", sourceId);
      return { status: "skipped", retryable: false };
    }
    console.warn(
      JSON.stringify({
        component: "sources",
        event: "orphaned_fetch_recovered",
        sourceId,
        fetchAttemptId: source.fetchAttemptId,
      }),
    );
  }

  if (!sourceKindSpec(source.kind)?.driver) {
    // Inline kinds (conversation / upload / text) are persisted once when created;
    // there is no remote fetch driver for them.
    console.warn("[sources] fetch skipped; unsupported source kind", source.kind);
    return { status: "skipped", retryable: false };
  }

  try {
    const started = await startSourceImport(env, source, crypto.randomUUID());
    if (!started) console.warn("[sources] fetch skipped; source archived before claim", sourceId);
    // Queue retry is deliberately not used after the DO begins. Its alarm and
    // consecutive-failure state are the single retry mechanism for every kind.
    return { status: "skipped", retryable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sources] import start failed", sourceId, message);
    return { status: "error", retryable: isRetryableFetchError(error) };
  }
}

const HOUR_MS = 60 * 60 * 1000;
/** Minimum age of the last fetch before a scheduled refresh; `manual` never schedules. */
const REFRESH_INTERVAL_MS: Record<string, number | undefined> = {
  // A few minutes of slack so the hourly cron does not skip a source fetched 59m ago.
  hourly: HOUR_MS - 5 * 60 * 1000,
  daily: 24 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
};

/** Enqueue scheduled refreshes and repair stale pending messages of any policy. */
export async function enqueueDueSourceRefreshes(env: Env): Promise<number> {
  const db = getDb(env);
  const nowMs = Date.now();
  const candidates = await db
    .select({
      id: schema.sources.id,
      kind: schema.sources.kind,
      status: schema.sources.status,
      fetchAttemptId: schema.sources.fetchAttemptId,
      refreshPolicy: schema.sources.refreshPolicy,
      lastFetchedAt: schema.sources.lastFetchedAt,
      updatedAt: schema.sources.updatedAt,
    })
    .from(schema.sources)
    .where(ne(schema.sources.status, "archived"))
    .all();

  let enqueued = 0;
  for (const source of candidates) {
    // Kinds without a fetch driver stay out of the scheduled queue even if an operator
    // manually changes refresh_policy.
    if (!sourceKindSpec(source.kind)?.refreshable) continue;
    const last = source.lastFetchedAt?.getTime() ?? 0;
    const intervalMs = REFRESH_INTERVAL_MS[source.refreshPolicy];
    const scheduledDue = intervalMs !== undefined && nowMs - last >= intervalMs;
    // Refresh sets a non-null fetchAttemptId before enqueue; create leaves it null.
    // Either way, a dropped queue message must be re-enqueued after an hour.
    const orphanedPending =
      source.status === "pending" && nowMs - source.updatedAt.getTime() >= 60 * 60 * 1000;
    const due = orphanedPending || scheduledDue;
    if (!due) continue;

    const claimed = await db
      .update(schema.sources)
      .set({ status: "pending", fetchAttemptId: null, updatedAt: new Date() })
      .where(and(eq(schema.sources.id, source.id), ne(schema.sources.status, "archived")))
      .returning({ id: schema.sources.id })
      .get();
    if (!claimed) continue;
    await env.SOURCE_FETCH_QUEUE.send({ type: "source_fetch", sourceId: source.id });
    enqueued += 1;
  }

  console.log(
    JSON.stringify({
      component: "sources",
      event: "cron_refresh_enqueued",
      enqueued,
      candidates: candidates.length,
      now: new Date(nowMs).toISOString(),
    }),
  );
  return enqueued;
}
