import { and, eq, isNull, max, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../../app/db/schema";
import { getDb } from "../../../../app/lib/db.server";
import { isRetryableFetchError } from "../retry-classification";
import type { SubrequestBudget } from "../subrequest-budget";

export type SourceImportKind = "google-chat-space" | "google-drive" | "website";

export const MAX_CONSECUTIVE_FAILURES = 5;
export const ALARM_CONTINUE_MS = 500;
/** D1 reads inside currentRun (run row + source lease row). */
export const CURRENT_RUN_SUBREQUESTS = 2;
/** D1 read inside the token resolver. */
export const ACCESS_TOKEN_SUBREQUESTS = 1;
/** Worst-case persistSourceDocument with assetPolicy replace/merge. */
export const PERSIST_REPLACE_SUBREQUESTS = 4;
export const PERSIST_MERGE_SUBREQUESTS = 5;
/** archiveMissingDocuments: lease check + update + final lease check. */
export const ARCHIVE_MISSING_SUBREQUESTS = 3;

export interface SourceImportTickContext {
  env: Env;
  sql: SqlStorage;
  budget: SubrequestBudget;
  runId: string;
  /** Resolved once per tick only for drivers that need Google credentials. */
  accessToken?: string;
}

export type SourceImportStepOutcome = {
  phaseComplete: boolean;
  /** When phaseComplete is false, ask the DO alarm to wait this long before the next tick. */
  continueAfterMs?: number;
};

export type CurrentSourceImport = NonNullable<Awaited<ReturnType<typeof currentRun>>>;

export interface SourceImportClaimRequest {
  sourceId: string;
  expectedStatus: string;
  expectedFetchAttemptId: string | null;
  fetchAttemptId: string;
}

export interface ClaimedSourceImport {
  runId: string;
  sourceId: string;
  kind: SourceImportKind;
  sinceCursor: string | null;
}

export function driverKindForSource(source: typeof schema.sources.$inferSelect): SourceImportKind {
  if (source.kind === "google-chat-space") return "google-chat-space";
  if (source.kind === "website") return "website";
  return "google-drive";
}

export async function currentRun(env: Env, runId: string) {
  const db = getDb(env);
  const run = await db
    .select()
    .from(schema.sourceImportRuns)
    .where(eq(schema.sourceImportRuns.id, runId))
    .get();
  if (!run) return null;
  const source = await db
    .select()
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.id, run.sourceId),
        eq(schema.sources.fetchAttemptId, run.fetchAttemptId),
        eq(schema.sources.status, "fetching"),
      ),
    )
    .get();
  return source ? { db, run, source } : null;
}

export async function maxSourceCursor(env: Env, sourceId: string): Promise<string | null> {
  const db = getDb(env);
  const row = await db
    .select({ cursor: max(schema.sourceDocuments.cursor) })
    .from(schema.sourceDocuments)
    .where(
      and(
        eq(schema.sourceDocuments.sourceId, sourceId),
        ne(schema.sourceDocuments.status, "archived"),
      ),
    )
    .get();
  return row?.cursor ?? null;
}

export function metaGet(sql: SqlStorage, key: string): string | null {
  const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
  return row?.value ?? null;
}

export function metaSet(sql: SqlStorage, key: string, value: string): void {
  sql.exec(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

export function metaNumber(sql: SqlStorage, key: string, fallback = 0): number {
  const raw = metaGet(sql, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Start an import and hand all continuation to the source-scoped Durable Object. */
export async function startSourceImport(
  env: Env,
  source: typeof schema.sources.$inferSelect,
  fetchAttemptId: string,
): Promise<boolean> {
  return env.SOURCE_IMPORT_DO.getByName(source.id).start({
    sourceId: source.id,
    expectedStatus: source.status,
    expectedFetchAttemptId: source.fetchAttemptId,
    fetchAttemptId,
  });
}

/** Claim D1 from inside the source-scoped Durable Object's serialized start RPC. */
export async function claimSourceImport(
  env: Env,
  request: SourceImportClaimRequest,
): Promise<ClaimedSourceImport | null> {
  const db = getDb(env);
  const id = nanoid();
  const source = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, request.sourceId))
    .get();
  if (!source) return null;
  const sinceCursor = await maxSourceCursor(env, request.sourceId);
  const kind = driverKindForSource(source);
  const claimed = await db
    .update(schema.sources)
    .set({
      status: "fetching",
      fetchAttemptId: request.fetchAttemptId,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.sources.id, request.sourceId),
        eq(schema.sources.status, request.expectedStatus),
        request.expectedFetchAttemptId === null
          ? isNull(schema.sources.fetchAttemptId)
          : eq(schema.sources.fetchAttemptId, request.expectedFetchAttemptId),
        ne(schema.sources.status, "archived"),
      ),
    )
    .returning({ id: schema.sources.id })
    .get();
  if (!claimed) return null;

  try {
    await db.batch([
      db
        .delete(schema.sourceImportRuns)
        .where(eq(schema.sourceImportRuns.sourceId, request.sourceId)),
      db.insert(schema.sourceImportRuns).values({
        id,
        sourceId: request.sourceId,
        kind,
        fetchAttemptId: request.fetchAttemptId,
        sinceCursor,
        phase: kind === "google-chat-space" ? "listing" : "start",
      }),
    ]);
    if (!(await currentRun(env, id))) {
      await db.delete(schema.sourceImportRuns).where(eq(schema.sourceImportRuns.id, id));
      return null;
    }
  } catch (error) {
    await releaseSourceImportClaim(env, request.sourceId, request.fetchAttemptId, id);
    throw error;
  }
  return { runId: id, sourceId: request.sourceId, kind, sinceCursor };
}

export async function releaseSourceImportClaim(
  env: Env,
  sourceId: string,
  fetchAttemptId: string,
  runId: string,
): Promise<void> {
  const db = getDb(env);
  await db.batch([
    db.delete(schema.sourceImportRuns).where(eq(schema.sourceImportRuns.id, runId)),
    db
      .update(schema.sources)
      .set({ status: "pending", fetchAttemptId: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.sources.id, sourceId),
          eq(schema.sources.fetchAttemptId, fetchAttemptId),
          eq(schema.sources.status, "fetching"),
        ),
      ),
  ]);
}

export async function commitPhase(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  phase: string,
): Promise<void> {
  ctx.budget.spend(1);
  const progress = Object.fromEntries(
    ctx.sql
      .exec<{ key: string; value: string }>("SELECT key, value FROM meta")
      .toArray()
      .map((row) => [row.key, row.value]),
  );
  await current.db
    .update(schema.sourceImportRuns)
    .set({ phase, progress: JSON.stringify(progress), updatedAt: new Date() })
    .where(eq(schema.sourceImportRuns.id, ctx.runId));
  current.run.phase = phase;
  current.run.progress = JSON.stringify(progress);
  ctx.sql.exec("DELETE FROM meta WHERE key = ?", "pending_phase");
}

export async function failSourceImportRun(
  env: Env,
  runId: string,
  error: unknown,
): Promise<{ retryable: boolean; consecutiveFailures: number }> {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = isRetryableFetchError(error);
  const current = await currentRun(env, runId);
  if (!current) return { retryable: false, consecutiveFailures: 0 };

  const consecutiveFailures = current.run.consecutiveFailures + 1;
  if (retryable && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
    await current.db
      .update(schema.sourceImportRuns)
      .set({ consecutiveFailures, errorMessage: message.slice(0, 2000), updatedAt: new Date() })
      .where(eq(schema.sourceImportRuns.id, runId));
    return { retryable: true, consecutiveFailures };
  }

  await current.db
    .update(schema.sourceImportRuns)
    .set({
      phase: "error",
      consecutiveFailures,
      errorMessage: message.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(schema.sourceImportRuns.id, runId));
  await current.db
    .update(schema.sources)
    .set({
      status: "error",
      fetchAttemptId: null,
      errorMessage: message.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.sources.id, current.source.id),
        eq(schema.sources.fetchAttemptId, current.run.fetchAttemptId),
      ),
    );
  return { retryable: false, consecutiveFailures };
}

export function retryAlarmDelayMs(consecutiveFailures: number): number {
  return Math.min(60_000, ALARM_CONTINUE_MS * 2 ** Math.max(0, consecutiveFailures - 1));
}
