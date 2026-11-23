import type { getDb } from "~/lib/db.server";

type Db = ReturnType<typeof getDb>;

const descendantsCte = `
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM pages WHERE id = ?
    UNION
    SELECT pages.id FROM pages JOIN descendants ON pages.parent_id = descendants.id
  )
`;

export async function archivePageAndDescendants(env: Env, _db: Db, pageId: string): Promise<void> {
  await env.DB.prepare(
    `${descendantsCte}
     UPDATE pages SET status = 'archived', updated_at = unixepoch()
     WHERE id IN (SELECT id FROM descendants)`,
  )
    .bind(pageId)
    .run();
}
