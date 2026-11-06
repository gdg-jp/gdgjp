import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";
import type { Plan, PlanBody } from "./plan";

type PlanRow = {
  id: number;
  campaign_id: number;
  version: number;
  body: string;
  status: Plan["status"];
  job_id: string | null;
  author: string;
  playbook_version: string;
  check_results: string;
  created_at: number;
};

const toPlan = (r: PlanRow): Plan => ({
  id: r.id,
  campaignId: r.campaign_id,
  version: r.version,
  body: JSON.parse(r.body),
  status: r.status,
  jobId: r.job_id,
  author: r.author,
  playbookVersion: r.playbook_version,
  checkResults: JSON.parse(r.check_results),
  createdAt: r.created_at,
});

export async function insertPlan(
  db: D1Database,
  input: {
    campaignId: number;
    body: PlanBody;
    jobId: string | null;
    author: string;
    playbookVersion: string;
    checkResults: CheckResult[];
  },
): Promise<{ id: number; version: number }> {
  const row = await db
    .prepare(
      `INSERT INTO plans (campaign_id, version, body, job_id, author, playbook_version, check_results)
       VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM plans WHERE campaign_id = ?), ?, ?, ?, ?, ?)
       RETURNING id, version`,
    )
    .bind(
      input.campaignId,
      input.campaignId,
      JSON.stringify(input.body),
      input.jobId,
      input.author,
      input.playbookVersion,
      JSON.stringify(input.checkResults),
    )
    .first<{ id: number; version: number }>();
  if (!row) throw new Error("plan insert returned nothing");
  return row;
}

export async function listPlans(db: D1Database, campaignId: number): Promise<Plan[]> {
  const { results } = await db
    .prepare("SELECT * FROM plans WHERE campaign_id = ? ORDER BY version DESC")
    .bind(campaignId)
    .all<PlanRow>();
  return results.map(toPlan);
}

export async function getPlan(
  db: D1Database,
  campaignId: number,
  version: number,
): Promise<Plan | null> {
  const row = await db
    .prepare("SELECT * FROM plans WHERE campaign_id = ? AND version = ?")
    .bind(campaignId, version)
    .first<PlanRow>();
  return row ? toPlan(row) : null;
}

export async function getPlanById(db: D1Database, id: number): Promise<Plan | null> {
  const row = await db.prepare("SELECT * FROM plans WHERE id = ?").bind(id).first<PlanRow>();
  return row ? toPlan(row) : null;
}

export async function adoptedPlan(db: D1Database, campaignId: number): Promise<Plan | null> {
  const row = await db
    .prepare(
      "SELECT * FROM plans WHERE campaign_id = ? AND status = 'adopted' ORDER BY version DESC LIMIT 1",
    )
    .bind(campaignId)
    .first<PlanRow>();
  return row ? toPlan(row) : null;
}

export async function markAdopted(
  db: D1Database,
  campaignId: number,
  version: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE plans SET status = 'superseded' WHERE campaign_id = ? AND status = 'adopted'",
      )
      .bind(campaignId),
    db
      .prepare("UPDATE plans SET status = 'adopted' WHERE campaign_id = ? AND version = ?")
      .bind(campaignId, version),
  ]);
}

/** Planned (untouched) items that came from an earlier plan: safe to replace on re-adoption. */
export async function deleteUntouchedPlanItems(
  db: D1Database,
  campaignId: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM schedule_items WHERE campaign_id = ? AND plan_version IS NOT NULL AND status = 'planned'
         AND draft_id IS NULL AND derived_from_item_id IS NULL`,
    )
    .bind(campaignId)
    .run();
  return result.meta.changes ?? 0;
}
