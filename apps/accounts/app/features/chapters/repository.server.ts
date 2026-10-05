import type { Chapter, ChapterKind, ChapterRegion, ChapterWithCounts } from "./types";

type ChapterRow = {
  id: number;
  slug: string;
  name: string;
  kind: ChapterKind;
  region: ChapterRegion;
  created_at: number;
};

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    region: row.region,
    createdAt: row.created_at,
  };
}

export async function listChapters(db: D1Database): Promise<Chapter[]> {
  const { results } = await db
    .prepare("SELECT id, slug, name, kind, region, created_at FROM chapters ORDER BY name")
    .all<ChapterRow>();
  return results.map(toChapter);
}

export async function listChaptersWithCounts(db: D1Database): Promise<ChapterWithCounts[]> {
  const { results } = await db
    .prepare(
      `SELECT
         c.id, c.slug, c.name, c.kind, c.region, c.created_at,
         COALESCE(SUM(CASE WHEN m.status = 'active'  THEN 1 ELSE 0 END), 0) AS active_count,
         COALESCE(SUM(CASE WHEN m.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count
       FROM chapters c
       LEFT JOIN memberships m ON m.chapter_id = c.id
       GROUP BY c.id
       ORDER BY c.name`,
    )
    .all<ChapterRow & { active_count: number; pending_count: number }>();
  return results.map((row) => ({
    ...toChapter(row),
    activeCount: row.active_count,
    pendingCount: row.pending_count,
  }));
}

const CHAPTERS_COUNTS_CACHE_NAME = "chapters-with-counts";
const CHAPTERS_COUNTS_CACHE_KEY = "https://accounts.gdgs.jp/__cache/chapters-with-counts";
const CHAPTERS_COUNTS_TTL_SECONDS = 30;

async function openChaptersCountsCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  return caches.open(CHAPTERS_COUNTS_CACHE_NAME);
}

export async function listChaptersWithCountsCached(db: D1Database): Promise<ChapterWithCounts[]> {
  const cache = await openChaptersCountsCache();
  if (!cache) return listChaptersWithCounts(db);
  const hit = await cache.match(CHAPTERS_COUNTS_CACHE_KEY);
  if (hit) return (await hit.json()) as ChapterWithCounts[];
  const data = await listChaptersWithCounts(db);
  await cache.put(
    CHAPTERS_COUNTS_CACHE_KEY,
    new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "cache-control": `max-age=${CHAPTERS_COUNTS_TTL_SECONDS}`,
      },
    }),
  );
  return data;
}

export async function bustChaptersWithCountsCache(): Promise<void> {
  const cache = await openChaptersCountsCache();
  if (!cache) return;
  await cache.delete(CHAPTERS_COUNTS_CACHE_KEY);
}

export async function getChapterBySlug(db: D1Database, slug: string): Promise<Chapter | null> {
  const row = await db
    .prepare("SELECT id, slug, name, kind, region, created_at FROM chapters WHERE slug = ?")
    .bind(slug)
    .first<ChapterRow>();
  return row ? toChapter(row) : null;
}

export async function getChapterById(db: D1Database, id: number): Promise<Chapter | null> {
  const row = await db
    .prepare("SELECT id, slug, name, kind, region, created_at FROM chapters WHERE id = ?")
    .bind(id)
    .first<ChapterRow>();
  return row ? toChapter(row) : null;
}

export async function createChapter(
  db: D1Database,
  input: { slug: string; name: string; kind: ChapterKind; region: ChapterRegion },
): Promise<void> {
  await db
    .prepare("INSERT INTO chapters (slug, name, kind, region) VALUES (?, ?, ?, ?)")
    .bind(input.slug, input.name, input.kind, input.region)
    .run();
}

export async function deleteChapter(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM chapters WHERE id = ?").bind(id).run();
}
