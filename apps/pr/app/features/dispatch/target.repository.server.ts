import type { AccountKind } from "~/features/integrations/account";
import type { DispatchTarget, TargetRef, TargetStatus } from "./target";

type Row = {
  id: number;
  schedule_item_id: number;
  account_id: number;
  status: TargetStatus;
  approved_by: string | null;
  approved_at: number | null;
  external_ref: string | null;
  error: string | null;
  campaign_id: number;
  kind: AccountKind;
  chapter_id: number;
  external_id: string;
  label: string;
  role: "primary" | "mirror";
};

const parseRef = (raw: string | null): TargetRef | null => {
  try {
    return raw ? (JSON.parse(raw) as TargetRef) : null;
  } catch {
    return null;
  }
};

const toTarget = (r: Row): DispatchTarget => ({
  id: r.id,
  scheduleItemId: r.schedule_item_id,
  accountId: r.account_id,
  status: r.status,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  externalRef: parseRef(r.external_ref),
  error: r.error,
  account: {
    id: r.account_id,
    campaignId: r.campaign_id,
    kind: r.kind,
    chapterId: r.chapter_id,
    externalId: r.external_id,
    label: r.label,
    role: r.role,
  },
});

const SELECT = `SELECT t.*, a.campaign_id, a.kind, a.chapter_id, a.external_id, a.label, a.role
  FROM dispatch_targets t JOIN campaign_accounts a ON a.id = t.account_id`;

/** One target per X account of the campaign; existing ones are kept. */
export async function ensureTargets(db: D1Database, campaignId: number, itemId: number) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO dispatch_targets (schedule_item_id, account_id)
       SELECT ?, id FROM campaign_accounts WHERE campaign_id = ? AND kind = 'x'`,
    )
    .bind(itemId, campaignId)
    .run();
}

export async function listTargets(db: D1Database, itemId: number): Promise<DispatchTarget[]> {
  const { results } = await db
    .prepare(`${SELECT} WHERE t.schedule_item_id = ? ORDER BY a.role = 'primary' DESC, a.id`)
    .bind(itemId)
    .all<Row>();
  return results.map(toTarget);
}

export async function listCampaignTargets(db: D1Database, campaignId: number) {
  const { results } = await db
    .prepare(`${SELECT} WHERE a.campaign_id = ?`)
    .bind(campaignId)
    .all<Row>();
  return results.map(toTarget);
}

export async function getTarget(db: D1Database, id: number): Promise<DispatchTarget | null> {
  const row = await db.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first<Row>();
  return row ? toTarget(row) : null;
}

/** Compare-and-set; false when another request moved the target first. */
export async function moveTarget(
  db: D1Database,
  id: number,
  from: TargetStatus[],
  to: TargetStatus,
  patch: {
    approvedBy?: string;
    actorSnapshot?: string;
    externalRef?: TargetRef;
    error?: string | null;
  } = {},
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE dispatch_targets SET status = ?,
         approved_by = COALESCE(?, approved_by),
         approved_at = CASE WHEN ? IS NULL THEN approved_at ELSE unixepoch() END,
         actor_snapshot = COALESCE(?, actor_snapshot),
         external_ref = COALESCE(?, external_ref),
         error = CASE WHEN ? THEN ? ELSE error END,
         updated_at = unixepoch()
       WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
    )
    .bind(
      to,
      patch.approvedBy ?? null,
      patch.approvedBy ?? null,
      patch.actorSnapshot ?? null,
      patch.externalRef ? JSON.stringify(patch.externalRef) : null,
      patch.error !== undefined ? 1 : 0,
      patch.error ?? null,
      id,
      ...from,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function actorSnapshotFor(db: D1Database, id: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT actor_snapshot FROM dispatch_targets WHERE id = ?")
    .bind(id)
    .first<{ actor_snapshot: string | null }>();
  return row?.actor_snapshot ?? null;
}

/** Scheduled sns posts to follow (hourly), with the approver's claims snapshot. */
export async function scheduledTargets(db: D1Database, limit = 100) {
  const { results } = await db
    .prepare(
      `${SELECT.replace("SELECT t.*", "SELECT t.*, t.actor_snapshot")}
       WHERE t.status = 'scheduled' ORDER BY t.updated_at LIMIT ?`,
    )
    .bind(limit)
    .all<Row & { actor_snapshot: string | null }>();
  return results.map((r) => ({ ...toTarget(r), actorSnapshot: r.actor_snapshot }));
}
