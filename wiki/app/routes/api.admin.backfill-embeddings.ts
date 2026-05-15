import { and, eq, isNull, ne, or } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { indexPageEmbeddings } from "~/lib/embedding-pipeline.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  await requireRole(request, env, "admin");
  const db = getDb(env);

  // Find published pages that need (re-)indexing.
  // Use or(isNull, ne) because NULL != 'indexed' evaluates to NULL in SQL,
  // so a plain ne() would silently skip pages with no status row.
  const pendingPages = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .leftJoin(schema.pageEmbeddingStatus, eq(schema.pages.id, schema.pageEmbeddingStatus.pageId))
    .where(
      and(
        eq(schema.pages.status, "published"),
        or(
          isNull(schema.pageEmbeddingStatus.status),
          ne(schema.pageEmbeddingStatus.status, "indexed"),
        ),
      ),
    )
    .limit(50)
    .all();

  const pageIds = pendingPages.map((p) => p.id);

  let indexed = 0;
  let errors = 0;

  for (const pageId of pageIds) {
    try {
      await indexPageEmbeddings(env, db, pageId);
      indexed++;
    } catch (err) {
      console.error("backfill-embeddings: failed", pageId, err);
      errors++;
      // Record error in status
      try {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        await db
          .insert(schema.pageEmbeddingStatus)
          .values({
            pageId,
            status: "error",
            errorMessage: errMsg,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.pageEmbeddingStatus.pageId,
            set: { status: "error", errorMessage: errMsg, updatedAt: new Date() },
          });
      } catch {
        // best-effort
      }
    }
  }

  // Count remaining
  const remaining = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .leftJoin(schema.pageEmbeddingStatus, eq(schema.pages.id, schema.pageEmbeddingStatus.pageId))
    .where(eq(schema.pages.status, "published"))
    .all();

  const indexedCount = await db
    .select({ pageId: schema.pageEmbeddingStatus.pageId })
    .from(schema.pageEmbeddingStatus)
    .where(eq(schema.pageEmbeddingStatus.status, "indexed"))
    .all();

  const remainingCount = remaining.length - indexedCount.length;

  return Response.json({ indexed, errors, remaining: Math.max(0, remainingCount) });
}
