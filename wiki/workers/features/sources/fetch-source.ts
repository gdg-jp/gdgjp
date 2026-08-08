import { and, eq, ne, notInArray, or } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import { getGoogleDriveAccessToken } from "../../../app/lib/google-drive-token.server";
import { resolveSourceAssets } from "./assets";
import { fetchGoogleDocSource } from "./google-doc";
import { persistSourceDocument } from "./persist";
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

  await db
    .update(schema.sources)
    .set({ status: "fetching", errorMessage: null, updatedAt: new Date() })
    .where(and(eq(schema.sources.id, sourceId), ne(schema.sources.status, "archived")));

  try {
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

      await persistSourceDocument(env, {
        sourceId,
        path: document.path,
        title: document.title,
        markdown: resolved.markdown,
        assets: resolved.assets,
      });
    }

    await archiveMissingDocuments(
      db,
      sourceId,
      fetched.documents.map((document) => document.path),
    );

    // Only commit completion if this job still owns the row. A user who archived the
    // source while the fetch was in flight must not have it silently reopened.
    await db
      .update(schema.sources)
      .set({
        title: fetched.title || source.title,
        status: "ready",
        errorMessage: null,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.sources.id, sourceId), eq(schema.sources.status, "fetching")));

    return { status: "ready", retryable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = isRetryableFetchError(error);
    console.error("[sources] fetch failed", sourceId, "retryable:", retryable, message);
    await db
      .update(schema.sources)
      .set({
        status: "error",
        errorMessage: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.sources.id, sourceId), eq(schema.sources.status, "fetching")));
    return { status: "error", retryable };
  }
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
  fetchedPaths: readonly string[],
): Promise<void> {
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
    .where(and(stale, ne(schema.sourceDocuments.status, "archived")));
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

    await db
      .update(schema.sources)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(schema.sources.id, source.id));
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
