import type { AuthUser } from "@gdgjp/gdg-lib";
import { and, eq, ne } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { SourceVisibility } from "~/features/sources/shared";
import { getDb } from "~/lib/db.server";
import type { Membership } from "./permissions";
import { canAssignSourceVisibility, parseSourceVisibilitySelection } from "./permissions";

export type EnqueueSourceRefreshResult =
  | { ok: true }
  | { ok: false; error: "archived"; status: 409 }
  | { ok: false; error: "unsupported_source_kind"; status: 409 }
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
  const source = await db
    .select({ kind: schema.sources.kind })
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (source?.kind === "conversation") {
    return { ok: false, error: "unsupported_source_kind", status: 409 };
  }
  const refreshRequestId = crypto.randomUUID();
  const claimed = await db
    .update(schema.sources)
    .set({
      status: "pending",
      errorMessage: null,
      fetchAttemptId: refreshRequestId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.sources.id, sourceId),
        ne(schema.sources.status, "archived"),
        ne(schema.sources.kind, "conversation"),
      ),
    )
    .returning({ id: schema.sources.id })
    .get();
  if (!claimed) {
    const current = await db
      .select({ kind: schema.sources.kind, status: schema.sources.status })
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .get();
    if (current?.kind === "conversation") {
      return { ok: false, error: "unsupported_source_kind", status: 409 };
    }
    return { ok: false, error: "archived", status: 409 };
  }

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
