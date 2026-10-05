import type { AuthUser } from "@gdgjp/gdg-lib";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import type { SourceKind, SourceRefreshPolicy, SourceVisibility } from "~/features/sources/shared";
import { getDb } from "~/lib/db.server";
import type { ClassifiedSource } from "./classify";
import { classifyDiscordChannel, classifyGoogleChatSpace, classifySourceUrl } from "./classify";
import type { Membership } from "./permissions";
import { canAssignSourceVisibility, parseSourceVisibilitySelection } from "./permissions";

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

export type { CreateInlineSourceInput } from "./inline-source.server";
export { MAX_INLINE_SOURCE_BYTES, createInlineSource } from "./inline-source.server";

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
