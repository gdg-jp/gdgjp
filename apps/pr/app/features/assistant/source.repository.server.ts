import type { Source, SourceImage } from "./source";

type Row = {
  id: number;
  campaign_id: number;
  url: string;
  title: string;
  text_key: string | null;
  images: string;
  status: Source["status"];
  error: string | null;
  fetched_at: number | null;
  created_by: string | null;
  created_at: number;
};

function toSource(row: Row): Source {
  let images: SourceImage[] = [];
  try {
    images = JSON.parse(row.images) as SourceImage[];
  } catch {}
  return {
    id: row.id,
    campaignId: row.campaign_id,
    url: row.url,
    title: row.title,
    textKey: row.text_key,
    images,
    status: row.status,
    error: row.error,
    fetchedAt: row.fetched_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** Add a URL (or mark an existing one for a fresh read). */
export async function upsertSource(
  db: D1Database,
  campaignId: number,
  url: string,
  userId: string | null,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO campaign_sources (campaign_id, url, created_by) VALUES (?, ?, ?)
       ON CONFLICT (campaign_id, url) DO UPDATE SET status = 'pending', error = NULL
       RETURNING id`,
    )
    .bind(campaignId, url, userId)
    .first<{ id: number }>();
  if (!row) throw new Error("source not saved");
  return row.id;
}

export async function finishSource(
  db: D1Database,
  id: number,
  result:
    | { status: "ok"; title: string; textKey: string; images: SourceImage[] }
    | { status: "error"; error: string },
): Promise<void> {
  if (result.status === "ok")
    await db
      .prepare(
        `UPDATE campaign_sources SET status = 'ok', title = ?, text_key = ?, images = ?, error = NULL,
           fetched_at = unixepoch() WHERE id = ?`,
      )
      .bind(result.title, result.textKey, JSON.stringify(result.images), id)
      .run();
  else
    await db
      .prepare(
        "UPDATE campaign_sources SET status = 'error', error = ?, fetched_at = unixepoch() WHERE id = ?",
      )
      .bind(result.error, id)
      .run();
}

export async function listSources(db: D1Database, campaignId: number): Promise<Source[]> {
  const { results } = await db
    .prepare("SELECT * FROM campaign_sources WHERE campaign_id = ? ORDER BY id")
    .bind(campaignId)
    .all<Row>();
  return results.map(toSource);
}

export async function getSource(
  db: D1Database,
  campaignId: number,
  id: number,
): Promise<Source | null> {
  const row = await db
    .prepare("SELECT * FROM campaign_sources WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .first<Row>();
  return row ? toSource(row) : null;
}

export async function deleteSource(db: D1Database, campaignId: number, id: number): Promise<void> {
  await db
    .prepare("DELETE FROM campaign_sources WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .run();
}
