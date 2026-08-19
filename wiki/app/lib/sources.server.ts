import type { AuthUser } from "@gdgjp/gdg-lib";
import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { getDb } from "~/lib/db.server";
import { getGoogleDriveDocumentKind, isGoogleDriveUrl } from "~/lib/google-drive-utils";
import { isGoogleFormUrl } from "~/lib/google-forms-utils";
import type { SourceKind, SourceRefreshPolicy, SourceVisibility } from "~/lib/sources-shared";
import { isSourceVisibility, sourceVisibilityNeedsChapter } from "~/lib/sources-shared";

export type { SourceKind, SourceRefreshPolicy, SourceVisibility };

export type ClassifiedSource =
  | {
      ok: true;
      kind: SourceKind;
      url: string;
      externalId: string | null;
      title?: string;
    }
  | { ok: false; error: string };

type Membership = { chapterId: string | number; role: string };

export { canAccessSource } from "@gdgjp/gdg-lib/acl";

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

const SPACE_NAME_RE = /^spaces\/[A-Za-z0-9_-]+$/;
const DISCORD_SNOWFLAKE_RE = /^\d{5,32}$/;

/** Build the canonical Chat Space URL stored on the sources row. */
export function googleChatSpaceUrl(spaceName: string): string {
  const id = spaceName.replace(/^spaces\//, "");
  return `https://mail.google.com/chat/u/0/#chat/space/${id}`;
}

/** Canonical Discord channel deep link stored on the sources row. */
export function discordChannelSourceUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
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

/**
 * Classify a Discord channel from the picker. `externalId` is the channel snowflake;
 * `url` must be `https://discord.com/channels/{guildId}/{channelId}`.
 */
export function classifyDiscordChannel(
  externalId: unknown,
  title: unknown,
  url: unknown,
): ClassifiedSource {
  if (typeof externalId !== "string" || !DISCORD_SNOWFLAKE_RE.test(externalId)) {
    return { ok: false, error: "invalid_channel" };
  }
  if (typeof url !== "string") return { ok: false, error: "invalid_url" };
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  const match = parsed.pathname.match(/^\/channels\/(\d+)\/(\d+)\/?$/);
  if (
    (parsed.hostname !== "discord.com" && parsed.hostname !== "discordapp.com") ||
    !match ||
    match[2] !== externalId
  ) {
    return { ok: false, error: "invalid_channel" };
  }
  const guildId = match[1];
  const displayTitle = typeof title === "string" && title.trim() ? title.trim() : `#${externalId}`;
  return {
    ok: true,
    kind: "discord-channel",
    url: discordChannelSourceUrl(guildId, externalId),
    externalId,
    title: displayTitle,
  };
}

/**
 * Pre-Stage-9 chapter-only assignment check. `canAssignSourceVisibility` replaced it for
 * sources; its only remaining caller is `agent-notes.server.ts`'s access-floor check, which
 * predates the visibility model and was out of scope for this stage.
 */
export function canAssignChapter(
  chapterId: string | null | undefined,
  user: AuthUser,
  chapterIds: readonly string[],
): boolean {
  if (chapterId == null || chapterId === "") return true;
  if (user.isAdmin) return true;
  return chapterIds.includes(chapterId);
}

export function canAssignSourceVisibility(
  visibility: SourceVisibility,
  chapterId: string | null,
  user: AuthUser,
  chapters: readonly Membership[],
): boolean {
  const needsChapter = sourceVisibilityNeedsChapter(visibility);
  if (needsChapter !== (chapterId != null && chapterId !== "")) return false;

  if (!needsChapter) return true;
  if (user.isAdmin) return true;
  return chapters.some((chapter) => String(chapter.chapterId) === chapterId);
}

/**
 * Resolve visibility and optional chapter from a submitted form/JSON payload.
 *
 * A source readable by every member has to be chosen deliberately rather than
 * fallen into by omitting a field.
 */
export function parseSourceVisibilitySelection(
  rawVisibility: unknown,
  rawChapter: unknown,
):
  | { ok: true; visibility: SourceVisibility; chapterId: string | null }
  | { ok: false; error: string } {
  if (!isSourceVisibility(rawVisibility)) {
    return { ok: false, error: "invalid_visibility" };
  }

  const needsChapter = sourceVisibilityNeedsChapter(rawVisibility);
  const chapterId = typeof rawChapter === "string" && rawChapter.length > 0 ? rawChapter : null;

  if (needsChapter && chapterId === null) {
    return { ok: false, error: "chapter_required" };
  }
  if (!needsChapter && chapterId !== null) {
    return { ok: false, error: "invalid_visibility" };
  }

  return { ok: true, visibility: rawVisibility, chapterId };
}

export interface CreateSourceInput {
  url?: unknown;
  /** When set with kind google-chat-space, registers a Chat Space instead of a URL. */
  kind?: unknown;
  externalId?: unknown;
  title?: unknown;
  visibility: unknown;
  chapter: unknown;
  refreshPolicy?: unknown;
  user: AuthUser;
  chapters: readonly Membership[];
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
        visibility: SourceVisibility;
        status: "pending" | "fetching" | "ready";
        refreshPolicy: SourceRefreshPolicy;
        createdAt?: Date;
      };
    }
  | { ok: false; error: string; status: number };

export const MAX_INLINE_SOURCE_BYTES = 1_000_000;

export interface CreateInlineSourceInput {
  title: unknown;
  content: unknown;
  visibility: unknown;
  chapter: unknown;
  externalId?: unknown;
  user: AuthUser;
  chapters: readonly Membership[];
}

export type EnqueueSourceRefreshResult =
  | { ok: true }
  | { ok: false; error: "archived"; status: 409 }
  | { ok: false; error: "enqueue_failed"; status: 503 };

export type UnarchiveSourceResult =
  | { ok: true }
  | { ok: false; error: "not_archived"; status: 409 };

export type DeleteArchivedSourceResult =
  | { ok: true }
  | { ok: false; error: "not_archived"; status: 409 }
  | { ok: false; error: "delete_failed"; status: 503 };

/** Restore retained source documents without scheduling a new fetch. */
export async function unarchiveSource(env: Env, sourceId: string): Promise<UnarchiveSourceResult> {
  const restored = await getDb(env)
    .update(schema.sources)
    .set({ status: "ready", fetchAttemptId: null, updatedAt: new Date() })
    .where(and(eq(schema.sources.id, sourceId), eq(schema.sources.status, "archived")))
    .returning({ id: schema.sources.id })
    .get();

  return restored ? { ok: true } : { ok: false, error: "not_archived", status: 409 };
}

/**
 * Permanently remove an archived source and every raw object stored beneath its
 * dedicated R2 prefix. R2 is cleaned first so a storage failure leaves the source
 * visible and retryable rather than orphaning raw material.
 */
export async function deleteArchivedSource(
  env: Env,
  sourceId: string,
): Promise<DeleteArchivedSourceResult> {
  const db = getDb(env);
  const source = await db
    .select({ id: schema.sources.id, status: schema.sources.status })
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (!source || source.status !== "archived") {
    return { ok: false, error: "not_archived", status: 409 };
  }

  try {
    const prefix = `raw/${sourceId}/`;
    let cursor: string | undefined;
    do {
      const page = await env.BUCKET.list({ prefix, cursor });
      if (page.objects.length > 0)
        await env.BUCKET.delete(page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.error("[sources] delete raw storage failed", sourceId, error);
    return { ok: false, error: "delete_failed", status: 503 };
  }

  const deleted = await db
    .delete(schema.sources)
    .where(and(eq(schema.sources.id, sourceId), eq(schema.sources.status, "archived")))
    .returning({ id: schema.sources.id })
    .get();
  return deleted ? { ok: true } : { ok: false, error: "not_archived", status: 409 };
}

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
      : input.kind === "discord-channel"
        ? classifyDiscordChannel(input.externalId, input.title, input.url)
        : typeof input.url === "string"
          ? classifySourceUrl(input.url, input.title)
          : { ok: false as const, error: "url_required" };

  if (!classified.ok) {
    return { ok: false, error: classified.error, status: 400 };
  }

  const selection = parseSourceVisibilitySelection(input.visibility, input.chapter);
  if (!selection.ok) {
    return { ok: false, error: selection.error, status: 400 };
  }
  if (
    !canAssignSourceVisibility(
      selection.visibility,
      selection.chapterId,
      input.user,
      input.chapters,
    )
  ) {
    return { ok: false, error: "forbidden_chapter", status: 403 };
  }

  const refreshPolicy: SourceRefreshPolicy =
    input.refreshPolicy === "daily" || input.refreshPolicy === "weekly"
      ? input.refreshPolicy
      : "manual";

  const db = getDb(env);
  // Drive/Chat identity is external_id; websites have no external id so the
  // normalized URL is the registration key. Archived rows still count — delete
  // or unarchive instead of registering a second copy of the same primary material.
  const duplicate = classified.externalId
    ? await db
        .select({ id: schema.sources.id })
        .from(schema.sources)
        .where(eq(schema.sources.externalId, classified.externalId))
        .get()
    : await db
        .select({ id: schema.sources.id })
        .from(schema.sources)
        .where(eq(schema.sources.url, classified.url))
        .get();
  if (duplicate) {
    return { ok: false, error: "duplicate_source", status: 409 };
  }

  const id = nanoid();
  const title = provisionalTitle(classified);

  await db.insert(schema.sources).values({
    id,
    kind: classified.kind,
    externalId: classified.externalId,
    url: classified.url,
    title,
    chapterId: selection.chapterId,
    visibility: selection.visibility,
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
      chapterId: selection.chapterId,
      visibility: selection.visibility,
      status: "pending",
      refreshPolicy,
    },
  };
}

/**
 * Persist an already-captured conversation log as a raw source. Unlike URL sources,
 * this path never queues a fetch: the supplied body is the canonical raw document.
 * The source remains `fetching` until both R2 and D1 have the document, so a retry
 * can repair a partial write without ever returning a falsely-ready source.
 */
export async function createInlineSource(
  env: Env,
  input: CreateInlineSourceInput,
): Promise<CreateSourceResult> {
  const selection = parseSourceVisibilitySelection(input.visibility, input.chapter);
  if (!selection.ok) {
    return { ok: false, error: selection.error, status: 400 };
  }
  if (
    !canAssignSourceVisibility(
      selection.visibility,
      selection.chapterId,
      input.user,
      input.chapters,
    )
  ) {
    return { ok: false, error: "forbidden_chapter", status: 403 };
  }

  if (typeof input.content !== "string" || input.content.length === 0) {
    return { ok: false, error: "content_required", status: 400 };
  }
  const content = new TextEncoder().encode(input.content);
  if (content.byteLength > MAX_INLINE_SOURCE_BYTES) {
    return { ok: false, error: "content_too_large", status: 413 };
  }

  const externalId =
    input.externalId === undefined
      ? null
      : typeof input.externalId === "string"
        ? input.externalId
        : null;
  if (input.externalId !== undefined && (!externalId || externalId.length === 0)) {
    return { ok: false, error: "invalid_external_id", status: 400 };
  }
  const title =
    typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Conversation";
  const db = getDb(env);

  const findExisting = async () => {
    if (externalId === null) return null;
    return db
      .select()
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.addedBy, input.user.id),
          eq(schema.sources.kind, "conversation"),
          eq(schema.sources.externalId, externalId),
        ),
      )
      .get();
  };

  let source = await findExisting();
  for (let insertAttempt = 0; ; insertAttempt += 1) {
    if (source?.status === "ready") {
      return { ok: true, source: inlineSourceResponse(source) };
    }

    if (!source) {
      const id = nanoid();
      try {
        await db.insert(schema.sources).values({
          id,
          kind: "conversation",
          externalId,
          url: `gdg-memory://${externalId ?? id}`,
          title,
          chapterId: selection.chapterId,
          visibility: selection.visibility,
          addedBy: input.user.id,
          status: "fetching",
          refreshPolicy: "manual",
        });
        source = await db
          .select()
          .from(schema.sources)
          .where(eq(schema.sources.id, id))
          .get();
      } catch (error) {
        // A concurrent caller can win the owner-scoped unique key between the
        // read and insert. Resolve it once, then follow the normal idempotency path.
        try {
          source = await findExisting();
        } catch (lookupError) {
          console.error("[sources] inline source collision lookup failed", lookupError);
          return { ok: false, error: "storage_error", status: 503 };
        }
        const uniqueCollision = isInlineSourceUniqueConstraintError(error);
        if (source && uniqueCollision) {
          // A row found with the owner-scoped key is the only safe evidence that
          // this was a concurrent idempotency collision. Follow its normal repair
          // path; never return a different owner's row.
          continue;
        }
        if (!uniqueCollision || insertAttempt >= 1) {
          console.error("[sources] inline source insert conflict", error);
          return {
            ok: false,
            error: uniqueCollision ? "conflict" : "storage_error",
            status: uniqueCollision ? 409 : 503,
          };
        }
      }
      if (!source) return { ok: false, error: "conflict", status: 409 };
    }

    // A non-ready row is a recoverable partial write. Claim it for this repair;
    // the owner/kind/external-id lookup above prevents cross-user overwrites.
    await db
      .update(schema.sources)
      .set({
        status: "fetching",
        title,
        chapterId: selection.chapterId,
        visibility: selection.visibility,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.sources.id, source.id),
          eq(schema.sources.addedBy, input.user.id),
          eq(schema.sources.kind, "conversation"),
        ),
      );

    try {
      const existingDocument = await db
        .select({ id: schema.sourceDocuments.id })
        .from(schema.sourceDocuments)
        .where(
          and(
            eq(schema.sourceDocuments.sourceId, source.id),
            eq(schema.sourceDocuments.path, "conversation.md"),
          ),
        )
        .get();
      const documentId = existingDocument?.id ?? nanoid();
      const contentHash = await inlineContentHash(content);
      const r2Key = `raw/${source.id}/${documentId}/${contentHash}.md`;

      await env.BUCKET.put(r2Key, content, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        customMetadata: { sha256: contentHash, path: "conversation.md" },
      });

      const now = new Date();
      await db
        .insert(schema.sourceDocuments)
        .values({
          id: documentId,
          sourceId: source.id,
          path: "conversation.md",
          title,
          r2Key,
          contentHash,
          mediaType: "text/markdown",
          capturedAt: now,
          status: "ready",
        })
        .onConflictDoUpdate({
          target: [schema.sourceDocuments.sourceId, schema.sourceDocuments.path],
          set: {
            title,
            r2Key,
            contentHash,
            mediaType: "text/markdown",
            capturedAt: now,
            status: "ready",
          },
        });

      const ready = await db
        .update(schema.sources)
        .set({ status: "ready", lastFetchedAt: now, fetchAttemptId: null, updatedAt: now })
        .where(
          and(
            eq(schema.sources.id, source.id),
            eq(schema.sources.addedBy, input.user.id),
            eq(schema.sources.kind, "conversation"),
          ),
        )
        .returning()
        .get();
      if (!ready) return { ok: false, error: "conflict", status: 409 };
      return { ok: true, source: inlineSourceResponse(ready) };
    } catch (error) {
      console.error("[sources] inline source persistence failed", source.id, error);
      // Deliberately leave the row fetching. The next request with this externalId
      // enters the repair path and can safely retry R2/document persistence.
      return { ok: false, error: "persist_failed", status: 503 };
    }
  }
}

function isInlineSourceUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /unique constraint failed.*(?:sources|owner_kind_external_id)/i.test(message) ||
    /constraint failed.*unique/i.test(message)
  );
}

async function inlineContentHash(content: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inlineSourceResponse(
  source: typeof schema.sources.$inferSelect,
): Extract<CreateSourceResult, { ok: true }>["source"] {
  return {
    id: source.id,
    kind: "conversation",
    url: source.url,
    title: source.title,
    chapterId: source.chapterId,
    visibility: source.visibility as SourceVisibility,
    status: source.status as "pending" | "fetching" | "ready",
    refreshPolicy: source.refreshPolicy as SourceRefreshPolicy,
    createdAt: source.createdAt,
  };
}

export async function updateSourceVisibility(
  env: Env,
  sourceId: string,
  input: {
    visibility: unknown;
    chapter: unknown;
    user: AuthUser;
    chapters: readonly Membership[];
  },
): Promise<
  | { ok: true; visibility: SourceVisibility; chapterId: string | null }
  | { ok: false; error: string; status: number }
> {
  const db = getDb(env);
  const source = await db
    .select({
      addedBy: schema.sources.addedBy,
    })
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();

  if (!source) return { ok: false, error: "not_found", status: 404 };
  if (source.addedBy !== input.user.id && !input.user.isAdmin) {
    return { ok: false, error: "forbidden", status: 403 };
  }

  const selection = parseSourceVisibilitySelection(input.visibility, input.chapter);
  if (!selection.ok) {
    return { ok: false, error: selection.error, status: 400 };
  }
  if (
    !canAssignSourceVisibility(
      selection.visibility,
      selection.chapterId,
      input.user,
      input.chapters,
    )
  ) {
    return { ok: false, error: "forbidden_chapter", status: 403 };
  }

  await db
    .update(schema.sources)
    .set({
      visibility: selection.visibility,
      chapterId: selection.chapterId,
      updatedAt: new Date(),
    })
    .where(eq(schema.sources.id, sourceId));

  return { ok: true, visibility: selection.visibility, chapterId: selection.chapterId };
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
  if (classified.kind === "discord-channel") {
    return `Discord #${classified.externalId}`;
  }
  try {
    return new URL(classified.url).hostname;
  } catch {
    return classified.url;
  }
}
