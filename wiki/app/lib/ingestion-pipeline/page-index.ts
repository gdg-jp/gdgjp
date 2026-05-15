import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import type { PageIndexEntry } from "~/lib/gemini.server";

export async function buildPageIndex(
  db: ReturnType<typeof drizzle>,
  userText: string,
): Promise<PageIndexEntry[]> {
  const allPages = await db
    .select({
      id: schema.pages.id,
      titleJa: schema.pages.titleJa,
      summaryJa: schema.pages.summaryJa,
      slug: schema.pages.slug,
      parentId: schema.pages.parentId,
    })
    .from(schema.pages)
    .where(eq(schema.pages.status, "published"))
    .limit(200)
    .all();

  if (allPages.length === 0) return [];

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
            LIMIT 200`,
      );
      for (const r of ftsResults) {
        ftsRankedIds.push(r.page_id);
      }
    }
  } catch {
    // FTS5 query failed — proceed with unranked pages
  }

  const ftsSet = new Set(ftsRankedIds);
  const toEntry = (r: (typeof allPages)[number]): PageIndexEntry => ({
    id: r.id,
    title: r.titleJa,
    summary: r.summaryJa,
    slug: r.slug,
    parentId: r.parentId,
  });

  const allPagesById = new Map(allPages.map((p) => [p.id, p]));
  const ranked = ftsRankedIds
    .map((id) => allPagesById.get(id))
    .filter((p): p is (typeof allPages)[number] => p != null)
    .map(toEntry);

  const unranked = allPages.filter((p) => !ftsSet.has(p.id)).map(toEntry);

  return [...ranked, ...unranked];
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
