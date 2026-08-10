import type { AuthUser } from "@gdgjp/gdg-lib";
import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { getDb } from "~/lib/db.server";
import { getGoogleDriveDocumentKind, isGoogleDriveUrl } from "~/lib/google-drive-utils";
import { isGoogleFormUrl } from "~/lib/google-forms-utils";
import { ALL_CHAPTERS } from "~/lib/sources-shared";
import type { SourceKind, SourceRefreshPolicy } from "~/lib/sources-shared";

export { ALL_CHAPTERS };
export type { SourceKind, SourceRefreshPolicy };

export type ClassifiedSource =
  | {
      ok: true;
      kind: SourceKind;
      url: string;
      externalId: string | null;
      title?: string;
    }
  | { ok: false; error: string };

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

const SPACE_NAME_RE = /^spaces\/[A-Za-z0-9_-]+$/;

/** Build the canonical Chat Space URL stored on the sources row. */
export function googleChatSpaceUrl(spaceName: string): string {
  const id = spaceName.replace(/^spaces\//, "");
  return `https://mail.google.com/chat/u/0/#chat/space/${id}`;
}

/** Normalize and classify a user-supplied URL for Stage 1 source registration. */
export function classifySourceUrl(raw: string, title?: unknown): ClassifiedSource {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "url_required" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "unsupported_url" };
  }

  const href = url.toString();

  if (isGoogleFormUrl(href)) {
    return { ok: false, error: "unsupported_url" };
  }

  if (isGoogleDriveUrl(href)) {
    const documentKind = getGoogleDriveDocumentKind(href);
    if (!documentKind) return { ok: false, error: "unsupported_url" };
    const externalId = extractDriveFileId(href);
    if (!externalId) return { ok: false, error: "invalid_url" };
    const kind: SourceKind =
      documentKind === "document"
        ? "google-doc"
        : documentKind === "spreadsheet"
          ? "google-sheet"
          : "google-slides";
    return {
      ok: true,
      kind,
      url: href,
      externalId,
      ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    };
  }

  return { ok: true, kind: "website", url: href, externalId: null };
}

/**
 * Classify a Space chosen from the Chat picker. `externalId` must be `spaces/…`.
 */
export function classifyGoogleChatSpace(externalId: unknown, title: unknown): ClassifiedSource {
  if (typeof externalId !== "string" || !SPACE_NAME_RE.test(externalId)) {
    return { ok: false, error: "invalid_space" };
  }
  const displayTitle = typeof title === "string" && title.trim() ? title.trim() : externalId;
  return {
    ok: true,
    kind: "google-chat-space",
    url: googleChatSpaceUrl(externalId),
    externalId,
    title: displayTitle,
  };
}

export function canAccessSource(
  source: { addedBy: string; chapterId: string | null },
  user: AuthUser,
  chapterIds: readonly string[],
): boolean {
  if (user.isAdmin) return true;
  if (source.addedBy === user.id) return true;
  if (source.chapterId === null) return true;
  return chapterIds.includes(source.chapterId);
}

export function canAssignChapter(
  chapterId: string | null | undefined,
  user: AuthUser,
  chapterIds: readonly string[],
): boolean {
  if (chapterId == null || chapterId === "") return true;
  if (user.isAdmin) return true;
  return chapterIds.includes(chapterId);
}

/**
 * Resolve the chapter a submitted form/JSON payload asks for.
 *
 * A source with no chapter is readable by every signed-in member, so it has to be
 * chosen deliberately (`ALL_CHAPTERS`) rather than fallen into by omitting a field.
 */
export function parseChapterSelection(
  raw: unknown,
): { ok: true; chapterId: string | null } | { ok: false; error: string } {
  if (raw === ALL_CHAPTERS) return { ok: true, chapterId: null };
  if (typeof raw === "string" && raw.length > 0) return { ok: true, chapterId: raw };
  return { ok: false, error: "chapter_required" };
}

export interface CreateSourceInput {
  url?: unknown;
  /** When set with kind google-chat-space, registers a Chat Space instead of a URL. */
  kind?: unknown;
  externalId?: unknown;
  title?: unknown;
  chapter: unknown;
  refreshPolicy?: unknown;
  user: AuthUser;
  chapterIds: readonly string[];
}

export type CreateSourceResult =
  | {
      ok: true;
      source: {
        id: string;
        kind: SourceKind;
        url: string;
        title: string;
        chapterId: string | null;
        status: "pending";
        refreshPolicy: SourceRefreshPolicy;
      };
    }
  | { ok: false; error: string; status: number };

export type EnqueueSourceRefreshResult =
  | { ok: true }
  | { ok: false; error: "archived"; status: 409 }
  | { ok: false; error: "enqueue_failed"; status: 503 };

/** Revoke any in-flight lease, move the source to pending, and enqueue its replacement fetch. */
export async function enqueueSourceRefresh(
  env: Env,
  sourceId: string,
): Promise<EnqueueSourceRefreshResult> {
  const db = getDb(env);
  const refreshRequestId = crypto.randomUUID();
  const claimed = await db
    .update(schema.sources)
    .set({
      status: "pending",
      errorMessage: null,
      fetchAttemptId: refreshRequestId,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.sources.id, sourceId), ne(schema.sources.status, "archived")))
    .returning({ id: schema.sources.id })
    .get();
  if (!claimed) return { ok: false, error: "archived", status: 409 };

  try {
    await env.SOURCE_FETCH_QUEUE.send({ type: "source_fetch", sourceId });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        component: "sources",
        event: "refresh_enqueue_failed",
        sourceId,
        error: message,
      }),
    );
    await db
      .update(schema.sources)
      .set({
        status: "error",
        errorMessage: `enqueue_failed: ${message}`.slice(0, 2000),
        fetchAttemptId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.sources.id, sourceId),
          eq(schema.sources.status, "pending"),
          eq(schema.sources.fetchAttemptId, refreshRequestId),
        ),
      );
    return { ok: false, error: "enqueue_failed", status: 503 };
  }
}

/**
 * Register a source and queue its first fetch. Both the `/sources` form and the JSON
 * API go through here — a second copy of this would be a second place for the chapter
 * check to drift out of, and raw material is exactly what must not leak between chapters.
 */
export async function createSource(
  env: Env,
  input: CreateSourceInput,
): Promise<CreateSourceResult> {
  const classified =
    input.kind === "google-chat-space"
      ? classifyGoogleChatSpace(input.externalId, input.title)
      : typeof input.url === "string"
        ? classifySourceUrl(input.url, input.title)
        : { ok: false as const, error: "url_required" };

  if (!classified.ok) {
    return { ok: false, error: classified.error, status: 400 };
  }

  const chapter = parseChapterSelection(input.chapter);
  if (!chapter.ok) {
    return { ok: false, error: chapter.error, status: 400 };
  }
  if (!canAssignChapter(chapter.chapterId, input.user, input.chapterIds)) {
    return { ok: false, error: "forbidden_chapter", status: 403 };
  }

  const refreshPolicy: SourceRefreshPolicy =
    input.refreshPolicy === "daily" || input.refreshPolicy === "weekly"
      ? input.refreshPolicy
      : "manual";

  const id = nanoid();
  const title = provisionalTitle(classified);
  const db = getDb(env);

  await db.insert(schema.sources).values({
    id,
    kind: classified.kind,
    externalId: classified.externalId,
    url: classified.url,
    title,
    chapterId: chapter.chapterId,
    addedBy: input.user.id,
    status: "pending",
    refreshPolicy,
  });

  try {
    await env.SOURCE_FETCH_QUEUE.send({ type: "source_fetch", sourceId: id });
  } catch (error) {
    // The row is already committed, so leaving it `pending` would strand it: a manual
    // source is never retried by the cron, and the caller would see a failure and
    // register the URL again. Mark it `error` instead — the row stays visible and the
    // existing 再取得 action re-enqueues it.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sources] enqueue failed", id, message);
    await db
      .update(schema.sources)
      .set({ status: "error", errorMessage: `enqueue_failed: ${message}`.slice(0, 2000) })
      .where(eq(schema.sources.id, id));
    return { ok: false, error: "enqueue_failed", status: 503 };
  }

  return {
    ok: true,
    source: {
      id,
      kind: classified.kind,
      url: classified.url,
      title,
      chapterId: chapter.chapterId,
      status: "pending",
      refreshPolicy,
    },
  };
}

/** Placeholder until the fetcher reports the real document title. */
function provisionalTitle(classified: Extract<ClassifiedSource, { ok: true }>): string {
  if (classified.title) return classified.title;
  if (
    classified.kind === "google-doc" ||
    classified.kind === "google-sheet" ||
    classified.kind === "google-slides"
  ) {
    return `Google Doc ${classified.externalId}`;
  }
  if (classified.kind === "google-chat-space") {
    return `Google Chat ${classified.externalId}`;
  }
  try {
    return new URL(classified.url).hostname;
  } catch {
    return classified.url;
  }
}
