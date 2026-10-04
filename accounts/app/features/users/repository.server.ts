export type UserSummary = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  isAdmin: boolean;
};

export async function getUserById(db: D1Database, userId: string): Promise<UserSummary | null> {
  const row = await db
    .prepare(`SELECT id, email, name, image, is_admin AS isAdmin FROM "user" WHERE id = ?`)
    .bind(userId)
    .first<{ id: string; email: string; name: string; image: string | null; isAdmin: number }>();
  if (!row) return null;
  return { ...row, isAdmin: row.isAdmin === 1 };
}

export async function getUsersByIds(
  db: D1Database,
  ids: string[],
): Promise<Record<string, UserSummary>> {
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT id, email, name FROM "user" WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<UserSummary>();
  const out: Record<string, UserSummary> = {};
  for (const u of results) out[u.id] = u;
  return out;
}
