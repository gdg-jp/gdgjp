import { eq, inArray } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";

type WikiDb = ReturnType<typeof getDb>;

export function inlineSourceIds(markdown: string): string[] {
  return [
    ...new Set(
      [...markdown.matchAll(/[（(]\s*source:\s*([A-Za-z0-9_-]{6,})\s*[）)]/g)].map((m) => m[1]),
    ),
  ];
}

type SourceRef = { sourceId: string | null; url: string; title: string };

export async function loadInlineSourceRefs(
  db: WikiDb,
  pageId: string,
  markdown: string,
): Promise<SourceRef[]> {
  const linked = await db
    .select({
      url: schema.pageSources.url,
      title: schema.pageSources.title,
      sourceId: schema.pageSources.sourceId,
    })
    .from(schema.pageSources)
    .where(eq(schema.pageSources.pageId, pageId))
    .all();
  const known = new Set(linked.map((ref) => ref.sourceId));
  const ids = inlineSourceIds(markdown).filter((id) => !known.has(id));
  if (ids.length === 0) return linked;
  const [sources, documents] = await Promise.all([
    db
      .select({ id: schema.sources.id, url: schema.sources.url, title: schema.sources.title })
      .from(schema.sources)
      .where(inArray(schema.sources.id, ids))
      .all(),
    db
      .select({
        id: schema.sourceDocuments.id,
        url: schema.sources.url,
        title: schema.sources.title,
        documentTitle: schema.sourceDocuments.title,
      })
      .from(schema.sourceDocuments)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceDocuments.sourceId))
      .where(inArray(schema.sourceDocuments.id, ids))
      .all(),
  ]);
  return [
    ...linked,
    ...sources.map((row) => ({ sourceId: row.id, url: row.url, title: row.title })),
    ...documents.map((row) => ({
      sourceId: row.id,
      url: row.url,
      title:
        row.documentTitle && row.documentTitle !== row.title
          ? `${row.title} — ${row.documentTitle}`
          : row.title,
    })),
  ];
}
