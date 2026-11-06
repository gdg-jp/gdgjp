/** One row per outward call (sns, tinyurl, Discord), success or not. Never secrets. */
export async function logDispatch(
  db: D1Database,
  entry: {
    campaignId: number;
    itemId: number | null;
    action: string;
    ok: boolean;
    detail?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO dispatch_log (campaign_id, schedule_item_id, action, ok, detail) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(entry.campaignId, entry.itemId, entry.action, entry.ok ? 1 : 0, entry.detail ?? null)
    .run();
}

export async function listDispatchLog(db: D1Database, campaignId: number, limit = 50) {
  const { results } = await db
    .prepare(
      "SELECT schedule_item_id, action, ok, detail, at FROM dispatch_log WHERE campaign_id = ? ORDER BY at DESC, id DESC LIMIT ?",
    )
    .bind(campaignId, limit)
    .all<{
      schedule_item_id: number | null;
      action: string;
      ok: number;
      detail: string | null;
      at: number;
    }>();
  return results.map((r) => ({
    itemId: r.schedule_item_id,
    action: r.action,
    ok: r.ok === 1,
    detail: r.detail,
    at: r.at,
  }));
}
