import { wikiPagePath } from "./wiki-page-path";
const ANCESTRY_DEPTH_CAP = 32;
const BATCH_CHUNK_SIZE = 50;

/**
 * Resolve root→leaf slug segments for a single page by walking `parent_id` upward.
 */
export async function getWikiCanonicalSlugPath(env: Env, pageId: string): Promise<string[]> {
  const result = await env.DB.prepare(
    `WITH RECURSIVE ancestry(id, slug, parent_id, depth) AS (
       SELECT id, slug, parent_id, 0 FROM pages WHERE id = ?
       UNION ALL
       SELECT pages.id, pages.slug, pages.parent_id, ancestry.depth + 1
       FROM pages JOIN ancestry ON pages.id = ancestry.parent_id
       WHERE ancestry.depth < ?
     )
     SELECT slug FROM ancestry ORDER BY depth DESC`,
  )
    .bind(pageId, ANCESTRY_DEPTH_CAP)
    .all<{ slug: string }>();

  return result.results.map((row) => row.slug);
}

/**
 * Resolve root→leaf slug segments for many pages in one (chunked) query.
 * `origin_id` rides along each recursive row so paths never mix across origins.
 */
export async function getWikiCanonicalSlugPaths(
  env: Env,
  pageIds: readonly string[],
): Promise<Map<string, string[]>> {
  const paths = new Map<string, string[]>();
  if (pageIds.length === 0) return paths;

  const uniqueIds = [...new Set(pageIds)];
  for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + BATCH_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `WITH RECURSIVE ancestry(origin_id, id, slug, parent_id, depth) AS (
         SELECT id AS origin_id, id, slug, parent_id, 0
         FROM pages WHERE id IN (${placeholders})
         UNION ALL
         SELECT ancestry.origin_id, pages.id, pages.slug, pages.parent_id, ancestry.depth + 1
         FROM pages JOIN ancestry ON pages.id = ancestry.parent_id
         WHERE ancestry.depth < ?
       )
       SELECT origin_id, slug, depth FROM ancestry ORDER BY origin_id, depth DESC`,
    )
      .bind(...chunk, ANCESTRY_DEPTH_CAP)
      .all<{ origin_id: string; slug: string; depth: number }>();

    for (const row of result.results) {
      const existing = paths.get(row.origin_id);
      if (existing) {
        existing.push(row.slug);
      } else {
        paths.set(row.origin_id, [row.slug]);
      }
    }
  }

  return paths;
}

/**
 * Full browser URLs (`/s/<space>/wiki/<root>/…/<leaf>`) for many pages. Use this for any
 * listing that may contain pages from more than one space.
 */
export async function getWikiPageUrls(
  env: Env,
  pageIds: readonly string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (pageIds.length === 0) return urls;
  const [paths, spaceSlugs] = await Promise.all([
    getWikiCanonicalSlugPaths(env, pageIds),
    getPageSpaceSlugs(env, pageIds),
  ]);
  for (const id of new Set(pageIds)) {
    const segments = paths.get(id);
    if (!segments || segments.length === 0) continue;
    urls.set(id, wikiPagePath(segments, spaceSlugs.get(id)));
  }
  return urls;
}

/** Space slug of each page. */
export async function getPageSpaceSlugs(
  env: Env,
  pageIds: readonly string[],
): Promise<Map<string, string>> {
  const slugs = new Map<string, string>();
  const uniqueIds = [...new Set(pageIds)];
  for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + BATCH_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `SELECT pages.id AS id, spaces.slug AS space_slug
       FROM pages JOIN spaces ON spaces.id = pages.space_id
       WHERE pages.id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ id: string; space_slug: string }>();
    for (const row of result.results) slugs.set(row.id, row.space_slug);
  }
  return slugs;
}
