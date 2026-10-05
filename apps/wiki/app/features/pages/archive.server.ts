import { deletePageEmbeddings } from "~/features/ai-search/embedding.server";
import type { getDb } from "~/lib/db.server";

type Db = ReturnType<typeof getDb>;

const descendantsCte = `
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM pages WHERE id = ?
    UNION
    SELECT pages.id FROM pages JOIN descendants ON pages.parent_id = descendants.id
  )
`;

/** Archives a page and every descendant in its page tree. */
export async function archivePageAndDescendants(env: Env, db: Db, pageId: string): Promise<void> {
  const result = await env.DB.prepare(`${descendantsCte} SELECT id FROM descendants`)
    .bind(pageId)
    .all<{ id: string }>();
  const pageIds = result.results.map((page) => page.id);

  await env.DB.prepare(
    `${descendantsCte}
     UPDATE pages SET status = 'archived', updated_at = unixepoch()
     WHERE id IN (SELECT id FROM descendants)`,
  )
    .bind(pageId)
    .run();

  await Promise.all(
    pageIds.map(async (id) => {
      try {
        await deletePageEmbeddings(env, db, id);
      } catch {
        // Embedding cleanup must not prevent archiving a page tree.
      }
    }),
  );
}
