import { and, eq, ne } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import { startSourceImport } from "./import/run";
import { isRetryableFetchError } from "./retry-classification";

export const SOURCE_REFRESH_CRON = "0 16 * * *";
export const TASK_REMINDER_CRON = "0 15 * * *";

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

  if (
    source.kind !== "google-chat-space" &&
    source.kind !== "discord-channel" &&
    source.kind !== "google-doc" &&
    source.kind !== "google-sheet" &&
    source.kind !== "google-slides" &&
    source.kind !== "website"
  ) {
    // Inline conversation logs are already persisted in R2 by createInlineSource;
    // there is no remote fetch driver for this kind.
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

/** Enqueue scheduled refreshes and repair stale pending messages of any policy. */
export async function enqueueDueSourceRefreshes(env: Env): Promise<number> {
  const db = getDb(env);
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
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
    // Inline conversation logs have no remote fetch driver, even if an operator
    // manually changes refresh_policy. Keep them out of the scheduled queue too.
    if (source.kind === "conversation") continue;
    const last = source.lastFetchedAt?.getTime() ?? 0;
    const scheduledDue =
      source.refreshPolicy === "daily" ? nowMs - last >= dayMs : nowMs - last >= 7 * dayMs;
    // Refresh sets a non-null fetchAttemptId before enqueue; create leaves it null.
    // Either way, a dropped queue message must be re-enqueued after an hour.
    const orphanedPending =
      source.status === "pending" && nowMs - source.updatedAt.getTime() >= 60 * 60 * 1000;
    const due =
      orphanedPending ||
      ((source.refreshPolicy === "daily" || source.refreshPolicy === "weekly") && scheduledDue);
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
