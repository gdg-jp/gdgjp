// ---------- Tags ----------

export async function setLinkTags(db: D1Database, linkId: string, tagIds: number[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM link_tags WHERE link_id = ?").bind(linkId),
  ];
  for (const tagId of tagIds) {
    stmts.push(
      db
        .prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)")
        .bind(linkId, tagId),
    );
  }
  await db.batch(stmts);
}

/**
 * `createTag` can fail on a name that already exists for this owner (or is a
 * shared chapter/global tag) — this resolves the id it collided with.
 */
export async function findExistingTagId(
  db: D1Database,
  name: string,
  ownerUserId: string,
): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM tags WHERE name = ? AND (owner_user_id = ? OR owner_user_id IS NULL)")
    .bind(name, ownerUserId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function listAllowedTagIds(
  db: D1Database,
  userId: string,
  tagIds: number[],
): Promise<number[]> {
  const ids = [...new Set(tagIds)];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT id FROM tags
       WHERE id IN (${placeholders})
         AND (owner_user_id = ? OR owner_user_id IS NULL)`,
    )
    .bind(...ids, userId)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}
