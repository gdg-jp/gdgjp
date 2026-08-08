import { and, eq, ne, notInArray, or } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import { getGoogleDriveAccessToken } from "../../../app/lib/google-drive-token.server";
import { resolveSourceAssets } from "./assets";
import { GOOGLE_CHAT_REAUTH_MESSAGE, fetchGoogleChatSource } from "./google-chat";
import { fetchGoogleDocSource } from "./google-doc";
import {
  isSourceFetchAttemptCurrent,
  persistSourceDocument,
  sourceFetchAttemptIsCurrent,
} from "./persist";
import { fetchWebsiteSource } from "./website";

export const SOURCE_REFRESH_CRON = "0 16 * * *";
export const TASK_REMINDER_CRON = "0 15 * * *";

export interface FetchSourceOutcome {
  status: "ready" | "skipped" | "error";
  /** False when retrying cannot change the result — a missing token, a bad URL, a 404. */
  retryable: boolean;
}

/**
 * Classify a failure so the queue consumer knows whether to retry.
 *
 * Google helpers put the HTTP status in their message, which is the only signal
 * available without rewriting them. Anything unrecognized is treated as transient:
 * a spurious retry is cheap, whereas giving up on a real network blip loses the fetch.
 */
export function isRetryableFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes("Google Drive is not connected") ||
    message.includes(GOOGLE_CHAT_REAUTH_MESSAGE) ||
    message.includes("Google Chat scopes are missing") ||
    message.includes("Unsupported Google Workspace URL") ||
    message.startsWith("Unsupported source kind") ||
    message.includes("invalid image type") ||
    message.includes("exceeds the 10 MB limit")
  ) {
    return false;
  }

  const status = Number(/\((\d{3})\)/.exec(message)?.[1]);
  if (!Number.isNaN(status)) {
    if (status === 408 || status === 429) return true;
    return status < 400 || status >= 500;
  }

  return true;
}

/**
 * Dispatcher: load the source, run the kind-specific fetcher, persist documents to R2.
 *
 * Failures are recorded on the row and reported back rather than thrown, so a source
 * that can never succeed does not cycle through the queue's whole retry budget.
 */
export async function fetchSource(env: Env, sourceId: string): Promise<FetchSourceOutcome> {
  const db = getDb(env);
  const source = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (!source) {
    console.warn("[sources] fetch skipped; source not found", sourceId);
    return { status: "skipped", retryable: false };
  }
  if (source.status === "archived") {
    console.warn("[sources] fetch skipped; source archived", sourceId);
    return { status: "skipped", retryable: false };
  }

  const attemptId = crypto.randomUUID();
  const claimed = await db
    .update(schema.sources)
    .set({
      status: "fetching",
      fetchAttemptId: attemptId,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.sources.id, sourceId), ne(schema.sources.status, "archived")))
    .returning({ id: schema.sources.id })
    .get();
  if (!claimed) {
    console.warn("[sources] fetch skipped; source archived before claim", sourceId);
    return { status: "skipped", retryable: false };
  }

  try {
    if (source.kind === "google-chat-space") {
      return await fetchAndPersistGoogleChat(env, source, attemptId);
    }

    const fetched =
      source.kind === "google-doc"
        ? await fetchGoogleDocSource(source.url, () =>
            getGoogleDriveAccessToken(env, db, source.addedBy),
          )
        : source.kind === "website"
          ? await fetchWebsiteSource(source.url, env.BROWSER)
          : null;

    if (!fetched) {
      throw new Error(`Unsupported source kind: ${source.kind}`);
    }

    for (const document of fetched.documents) {
      // Images must be stored and the placeholders rewritten before hashing, so the
      // document's content_hash covers the markdown the agent will actually read.
      const resolved =
        document.images.length > 0 && fetched.accessToken
          ? await resolveSourceAssets(env, {
              sourceId,
              markdown: document.markdown,
              images: document.images,
              accessToken: fetched.accessToken,
            })
          : { markdown: document.markdown, assets: [] };

      const persisted = await persistSourceDocument(env, {
        sourceId,
        fetchAttemptId: attemptId,
        path: document.path,
        title: document.title,
        markdown: resolved.markdown,
        assets: resolved.assets,
      });
      if (persisted.skipped) return { status: "skipped", retryable: false };
    }

    if (
      !(await archiveMissingDocuments(
        db,
        sourceId,
        attemptId,
        fetched.documents.map((document) => document.path),
      ))
    ) {
      return { status: "skipped", retryable: false };
    }

    // Only commit completion if this job still owns the row. A user who archived the
    // source while the fetch was in flight must not have it silently reopened.
    const completed = await db
      .update(schema.sources)
      .set({
        title: fetched.title || source.title,
        status: "ready",
        fetchAttemptId: null,
        errorMessage: null,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.sources.id, sourceId),
          eq(schema.sources.fetchAttemptId, attemptId),
          eq(schema.sources.status, "fetching"),
        ),
      )
      .returning({ id: schema.sources.id })
      .get();
    if (!completed) return { status: "skipped", retryable: false };

    return { status: "ready", retryable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = isRetryableFetchError(error);
    console.error("[sources] fetch failed", sourceId, "retryable:", retryable, message);
    const failed = await db
      .update(schema.sources)
      .set({
        status: "error",
        fetchAttemptId: null,
        errorMessage: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.sources.id, sourceId),
          eq(schema.sources.fetchAttemptId, attemptId),
          eq(schema.sources.status, "fetching"),
        ),
      )
      .returning({ id: schema.sources.id })
      .get();
    if (!failed) return { status: "skipped", retryable: false };
    return { status: "error", retryable };
  }
}

async function fetchAndPersistGoogleChat(
  env: Env,
  source: typeof schema.sources.$inferSelect,
  attemptId: string,
): Promise<FetchSourceOutcome> {
  const db = getDb(env);
  const spaceName = source.externalId;
  if (!spaceName) {
    throw new Error("Google Chat source is missing external_id (spaces/…)");
  }

  const fetched = await fetchGoogleChatSource(env, {
    sourceId: source.id,
    spaceName,
    addedBy: source.addedBy,
  });

  for (const document of fetched.documents) {
    const persisted = await persistSourceDocument(env, {
      sourceId: source.id,
      fetchAttemptId: attemptId,
      path: document.path,
      title: document.title,
      markdown: document.markdown,
      cursor: document.cursor,
      metadata: document.metadata,
      assets: document.assets,
      assetPolicy: document.assetPolicy,
    });
    if (persisted.skipped) return { status: "skipped", retryable: false };
  }

  if (!(await archiveMissingDocuments(db, source.id, attemptId, fetched.retainedPaths))) {
    return { status: "skipped", retryable: false };
  }

  const completed = await db
    .update(schema.sources)
    .set({
      title: fetched.title || source.title,
      status: "ready",
      fetchAttemptId: null,
      errorMessage: null,
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.sources.id, source.id),
        eq(schema.sources.fetchAttemptId, attemptId),
        eq(schema.sources.status, "fetching"),
      ),
    )
    .returning({ id: schema.sources.id })
    .get();
  if (!completed) return { status: "skipped", retryable: false };

  return { status: "ready", retryable: false };
}

/**
 * Retire source_documents whose path the source no longer produces — a deleted or
 * emptied Google Docs tab, a page dropped from a crawl. Without this they stay `ready`
 * and later consumers keep reading material the source has already discarded.
 *
 * The rows and their R2 objects are kept: raw is append-only, and `persistSourceDocument`
 * restores a path to `ready` if it ever comes back.
 */
async function archiveMissingDocuments(
  db: ReturnType<typeof getDb>,
  sourceId: string,
  attemptId: string,
  fetchedPaths: readonly string[],
): Promise<boolean> {
  if (!(await isSourceFetchAttemptCurrent(db, sourceId, attemptId))) return false;
  const stale =
    fetchedPaths.length === 0
      ? eq(schema.sourceDocuments.sourceId, sourceId)
      : and(
          eq(schema.sourceDocuments.sourceId, sourceId),
          notInArray(schema.sourceDocuments.path, [...fetchedPaths]),
        );

  await db
    .update(schema.sourceDocuments)
    .set({ status: "archived" })
    .where(
      and(
        stale,
        ne(schema.sourceDocuments.status, "archived"),
        sourceFetchAttemptIsCurrent(sourceId, attemptId),
      ),
    );
  return isSourceFetchAttemptCurrent(db, sourceId, attemptId);
}

/** Enqueue due sources for automatic refresh (daily / weekly policies). */
export async function enqueueDueSourceRefreshes(env: Env): Promise<number> {
  const db = getDb(env);
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const candidates = await db
    .select({
      id: schema.sources.id,
      refreshPolicy: schema.sources.refreshPolicy,
      lastFetchedAt: schema.sources.lastFetchedAt,
    })
    .from(schema.sources)
    .where(
      and(
        ne(schema.sources.status, "archived"),
        or(eq(schema.sources.refreshPolicy, "daily"), eq(schema.sources.refreshPolicy, "weekly")),
      ),
    )
    .all();

  let enqueued = 0;
  for (const source of candidates) {
    const last = source.lastFetchedAt?.getTime() ?? 0;
    const due =
      source.refreshPolicy === "daily" ? nowMs - last >= dayMs : nowMs - last >= 7 * dayMs;
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
