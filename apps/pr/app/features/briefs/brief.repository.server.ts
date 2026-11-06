import type { Brief } from "./brief";

export type StoredBrief = { version: number; brief: Brief; author: string; createdAt: number };

export async function latestBrief(db: D1Database, campaignId: number): Promise<StoredBrief | null> {
  const row = await db
    .prepare(
      "SELECT version, body, author, created_at FROM briefs WHERE campaign_id = ? ORDER BY version DESC LIMIT 1",
    )
    .bind(campaignId)
    .first<{ version: number; body: string; author: string; created_at: number }>();
  return row
    ? {
        version: row.version,
        brief: JSON.parse(row.body),
        author: row.author,
        createdAt: row.created_at,
      }
    : null;
}

export async function briefVersion(
  db: D1Database,
  campaignId: number,
  version: number,
): Promise<StoredBrief | null> {
  const row = await db
    .prepare(
      "SELECT version, body, author, created_at FROM briefs WHERE campaign_id = ? AND version = ?",
    )
    .bind(campaignId, version)
    .first<{ version: number; body: string; author: string; created_at: number }>();
  return row
    ? {
        version: row.version,
        brief: JSON.parse(row.body),
        author: row.author,
        createdAt: row.created_at,
      }
    : null;
}

/**
 * Insert the next version (never update) and copy the event facts onto the campaign row.
 * Returns the new version.
 */
export async function saveBrief(
  db: D1Database,
  campaignId: number,
  brief: Brief,
  author: string,
): Promise<number> {
  const eventAt = Math.floor(Date.parse(brief.event.startAt) / 1000);
  const [inserted] = await db.batch<{ version: number }>([
    db
      .prepare(
        `INSERT INTO briefs (campaign_id, version, body, author)
         VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM briefs WHERE campaign_id = ?), ?, ?)
         RETURNING version`,
      )
      .bind(campaignId, campaignId, JSON.stringify(brief), author),
    db
      .prepare(
        "UPDATE campaigns SET event_at = ?, venue = ?, budget_total_yen = ?, updated_at = unixepoch() WHERE id = ?",
      )
      .bind(
        Number.isNaN(eventAt) ? null : eventAt,
        brief.event.venue || null,
        brief.budget.totalYen,
        campaignId,
      ),
  ]);
  const version = inserted?.results?.[0]?.version;
  if (typeof version !== "number") throw new Error("brief insert returned no version");
  return version;
}
