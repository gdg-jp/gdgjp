import { and, eq, ne } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { sourceKindSpec } from "../../../app/features/sources/kinds";
import { getDb } from "../../../app/lib/db.server";
import { startSourceImport } from "./import/run";
import { isRetryableFetchError } from "./retry-classification";

export const SOURCE_REFRESH_CRON = "0 * * * *";
export const TASK_REMINDER_CRON = "0 15 * * *";
export const AGENT_NIGHTLY_CRON = "0 17 * * *";

export interface FetchSourceOutcome {
  status: "ready" | "skipped" | "error";
  retryable: boolean;
}

export { isRetryableFetchError };

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
    console.warn("[sources] fetch skipped; unsupported source kind", source.kind);
    return { status: "skipped", retryable: false };
  }

  try {
    const started = await startSourceImport(env, source, crypto.randomUUID());
    if (!started) console.warn("[sources] fetch skipped; source archived before claim", sourceId);
    return { status: "skipped", retryable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sources] import start failed", sourceId, message);
    return { status: "error", retryable: isRetryableFetchError(error) };
  }
}

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_INTERVAL_MS: Record<string, number | undefined> = {
  hourly: HOUR_MS - 5 * 60 * 1000,
  daily: 24 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
};

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
    if (!sourceKindSpec(source.kind)?.refreshable) continue;
    const last = source.lastFetchedAt?.getTime() ?? 0;
    const intervalMs = REFRESH_INTERVAL_MS[source.refreshPolicy];
    const scheduledDue = intervalMs !== undefined && nowMs - last >= intervalMs;
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
