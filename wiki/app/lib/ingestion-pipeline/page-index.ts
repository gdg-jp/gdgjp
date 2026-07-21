import { and, eq, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import type { PageIndexEntry } from "~/lib/gemini.server";

export async function buildPageIndex(
  db: ReturnType<typeof drizzle>,
  userText: string,
): Promise<PageIndexEntry[]> {
  const ftsRankedIds: string[] = [];
  try {
    const sanitized = userText
      .replace(/["'*^():{}[\]<>~@#$&|\\+\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    if (sanitized) {
      const orQuery = sanitized.split(" ").filter(Boolean).join(" OR ");
      const ftsResults = await db.all<{ page_id: string }>(
        sql`SELECT page_id FROM pages_fts
            WHERE pages_fts MATCH ${orQuery}
            ORDER BY rank
            LIMIT 12`,
      );
      for (const r of ftsResults) {
        ftsRankedIds.push(r.page_id);
      }
    }
  } catch {
    // Do not fall back to all pages: passing all page titles to the model was
    // the source of context overflows on large wikis.
  }

  if (ftsRankedIds.length === 0) return [];

  const pages = await db
    .select({
      id: schema.pages.id,
      titleJa: schema.pages.titleJa,
      summaryJa: schema.pages.summaryJa,
      slug: schema.pages.slug,
      parentId: schema.pages.parentId,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.status, "published"), inArray(schema.pages.id, ftsRankedIds)))
    .all();

  const toEntry = (r: (typeof pages)[number]): PageIndexEntry => ({
    id: r.id,
    title: r.titleJa,
    summary: r.summaryJa,
    slug: r.slug,
    parentId: r.parentId,
  });

  const pagesById = new Map(pages.map((page) => [page.id, page]));
  return ftsRankedIds
    .map((id) => pagesById.get(id))
    .filter((page): page is (typeof pages)[number] => page != null)
    .map(toEntry);
}

export function generateSlug(title: string, englishHint?: string): string {
  const source = englishHint?.trim() || title;
  return (
    source
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "-")
      .replace(/[^\w-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || `page-${Date.now()}`
  );
}
