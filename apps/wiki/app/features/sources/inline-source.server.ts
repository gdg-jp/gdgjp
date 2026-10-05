import type { AuthUser } from "@gdgjp/gdg-lib";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import type { SourceRefreshPolicy, SourceVisibility } from "~/features/sources/shared";
import { getDb } from "~/lib/db.server";
import type { CreateSourceResult } from "./create.server";
import type { Membership } from "./permissions";
import { canAssignSourceVisibility, parseSourceVisibilitySelection } from "./permissions";

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
        source = await db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
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
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current != null && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (
      /unique constraint failed.*(?:sources|owner_kind_external_id)/i.test(message) ||
      /constraint failed.*unique/i.test(message)
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }

  return false;
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
