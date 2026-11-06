export type ConnpassJobKind =
  | "update_event"
  | "publish_event"
  | "upload_event_image"
  | "upsert_survey"
  | "send_event_message"
  | "create_sub_event";

export type LedgerRow = {
  jobId: string;
  campaignId: number;
  itemId: number | null;
  targetId: number | null;
  kind: ConnpassJobKind;
  status: "queued" | "running" | "succeeded" | "failed";
  actorSnapshot: string;
  error: string | null;
  createdAt: number;
};

type Row = {
  job_id: string;
  campaign_id: number;
  schedule_item_id: number | null;
  target_id: number | null;
  kind: ConnpassJobKind;
  status: LedgerRow["status"];
  actor_snapshot: string;
  error: string | null;
  created_at: number;
};

const toRow = (r: Row): LedgerRow => ({
  jobId: r.job_id,
  campaignId: r.campaign_id,
  itemId: r.schedule_item_id,
  targetId: r.target_id,
  kind: r.kind,
  status: r.status,
  actorSnapshot: r.actor_snapshot,
  error: r.error,
  createdAt: r.created_at,
});

export async function recordConnpassJob(
  db: D1Database,
  row: Omit<LedgerRow, "status" | "error" | "createdAt">,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO connpass_jobs (job_id, campaign_id, schedule_item_id, target_id, kind, actor_snapshot)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.jobId, row.campaignId, row.itemId, row.targetId, row.kind, row.actorSnapshot)
    .run();
}

export async function openConnpassJobs(db: D1Database, limit = 50): Promise<LedgerRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM connpass_jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT ?",
    )
    .bind(limit)
    .all<Row>();
  return results.map(toRow);
}

export async function listConnpassJobs(db: D1Database, campaignId: number, limit = 20) {
  const { results } = await db
    .prepare("SELECT * FROM connpass_jobs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(campaignId, limit)
    .all<Row>();
  return results.map(toRow);
}

export async function setConnpassJobStatus(
  db: D1Database,
  jobId: string,
  status: LedgerRow["status"],
  error: string | null,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE connpass_jobs SET status = ?, error = ?,
         finished_at = CASE WHEN ? IN ('succeeded','failed') THEN unixepoch() ELSE finished_at END
       WHERE job_id = ? AND status != ?`,
    )
    .bind(status, error, status, jobId, status)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
