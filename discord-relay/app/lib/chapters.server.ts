/**
 * Chapter metadata display cache (INFO-001).
 * Source of truth is GDG Accounts directory API (`api.chapters.directory`).
 */

export type ChapterDirectoryEntry = {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  region?: string;
};

export async function syncChaptersFromDirectory(env: Env): Promise<void> {
  const accountsUrl = env.ACCOUNTS_URL.replace(/\/+$/, "");
  const url = `${accountsUrl}/api/chapters/directory`;
  const fetcher = env.ACCOUNTS
    ? (input: RequestInfo | URL, init?: RequestInit) => env.ACCOUNTS.fetch(input, init)
    : fetch;

  try {
    const res = await fetcher(url);
    if (!res.ok) return;
    const body = (await res.json()) as { chapters?: ChapterDirectoryEntry[] };
    if (!Array.isArray(body?.chapters) || body.chapters.length === 0) return;

    const now = Math.floor(Date.now() / 1000);
    const statements = body.chapters.map((ch) =>
      env.DB.prepare(
        `INSERT INTO chapters (chapter_id, slug, name, kind, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET
           slug = excluded.slug,
           name = excluded.name,
           kind = excluded.kind,
           fetched_at = excluded.fetched_at`,
      ).bind(Number(ch.id), ch.slug, ch.name, ch.kind ?? null, now),
    );

    await env.DB.batch(statements);
  } catch (err) {
    // Non-fatal background directory sync failure.
    console.warn("Failed to sync chapters directory:", err);
  }
}

export async function getChapterDisplayName(
  db: D1Database,
  chapterId: number,
  fallbackSlug: string,
): Promise<string> {
  const row = await db
    .prepare("SELECT name FROM chapters WHERE chapter_id = ?")
    .bind(chapterId)
    .first<{ name: string | null }>();
  return row?.name || fallbackSlug;
}

export async function getChapterDisplayNames(
  db: D1Database,
  chapterIds: number[],
): Promise<Map<number, string>> {
  if (chapterIds.length === 0) return new Map();
  const placeholders = chapterIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT chapter_id, name, slug FROM chapters WHERE chapter_id IN (${placeholders})`)
    .bind(...chapterIds)
    .all<{ chapter_id: number; name: string | null; slug: string }>();

  const map = new Map<number, string>();
  for (const r of results ?? []) {
    map.set(r.chapter_id, r.name || r.slug);
  }
  return map;
}
