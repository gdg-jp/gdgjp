export type UserSummary = { id: string; email: string; name: string; image: string | null };

export async function getUsersByIds(
  db: D1Database,
  ids: string[],
): Promise<Record<string, UserSummary>> {
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT id, email, name, image FROM "user" WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<UserSummary>();
  const out: Record<string, UserSummary> = {};
  for (const u of results) out[u.id] = u;
  return out;
}
