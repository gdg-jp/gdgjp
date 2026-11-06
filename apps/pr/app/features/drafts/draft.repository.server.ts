import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";
import type { Draft, DraftReview, DraftVersion } from "./draft";
import type { DraftKind } from "./draft-kinds";
import type { DraftStatus } from "./state-machine";

type DraftRow = {
  id: number;
  campaign_id: number;
  kind: DraftKind;
  schedule_item_id: number | null;
  title: string;
  current_version: number;
  status: DraftStatus;
  assignee_user_id: string | null;
  reviewer_user_id: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  approved_at: number | null;
  created_at: number;
  updated_at: number;
};

const toDraft = (r: DraftRow): Draft => ({
  id: r.id,
  campaignId: r.campaign_id,
  kind: r.kind,
  scheduleItemId: r.schedule_item_id,
  title: r.title,
  currentVersion: r.current_version,
  status: r.status,
  assigneeUserId: r.assignee_user_id,
  reviewerUserId: r.reviewer_user_id,
  reviewedBy: r.reviewed_by,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type VersionRow = {
  id: number;
  draft_id: number;
  version: number;
  author: "agent" | "human";
  user_id: string | null;
  job_id: string | null;
  content: string;
  playbook_version: string;
  check_results: string;
  created_at: number;
};

const toVersion = (r: VersionRow): DraftVersion => ({
  id: r.id,
  draftId: r.draft_id,
  version: r.version,
  author: r.author,
  userId: r.user_id,
  jobId: r.job_id,
  content: JSON.parse(r.content),
  playbookVersion: r.playbook_version,
  checkResults: JSON.parse(r.check_results),
  createdAt: r.created_at,
});

export async function createDraft(
  db: D1Database,
  input: {
    campaignId: number;
    kind: DraftKind;
    title: string;
    scheduleItemId: number | null;
    assigneeUserId?: string | null;
    reviewerUserId?: string | null;
  },
): Promise<number> {
  const statements = [
    db
      .prepare(
        `INSERT INTO drafts (campaign_id, kind, title, schedule_item_id, assignee_user_id, reviewer_user_id)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        input.campaignId,
        input.kind,
        input.title,
        input.scheduleItemId,
        input.assigneeUserId ?? null,
        input.reviewerUserId ?? null,
      ),
  ];
  const [row] = await db.batch<{ id: number }>(statements);
  const id = row?.results?.[0]?.id;
  if (typeof id !== "number") throw new Error("draft insert returned no id");
  if (input.scheduleItemId !== null) {
    await db
      .prepare("UPDATE schedule_items SET draft_id = ? WHERE id = ?")
      .bind(id, input.scheduleItemId)
      .run();
  }
  return id;
}

/**
 * Append a version (never UPDATE content) and move the draft to `status`. The schedule item
 * follows when `itemStatus` is given.
 */
export async function appendVersion(
  db: D1Database,
  draftId: number,
  input: {
    author: "agent" | "human";
    userId: string | null;
    jobId: string | null;
    content: unknown;
    playbookVersion: string;
    checkResults: CheckResult[];
    status: DraftStatus;
    itemStatus?: string | null;
  },
): Promise<number> {
  const [inserted] = await db.batch<{ version: number }>([
    db
      .prepare(
        `INSERT INTO draft_versions (draft_id, version, author, user_id, job_id, content, playbook_version, check_results)
         VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM draft_versions WHERE draft_id = ?), ?, ?, ?, ?, ?, ?)
         RETURNING version`,
      )
      .bind(
        draftId,
        draftId,
        input.author,
        input.userId,
        input.jobId,
        JSON.stringify(input.content),
        input.playbookVersion,
        JSON.stringify(input.checkResults),
      ),
    db
      .prepare(
        `UPDATE drafts SET current_version = (SELECT MAX(version) FROM draft_versions WHERE draft_id = ?),
           status = ?, review_requested_at = CASE WHEN ? = 'in_review' THEN unixepoch() ELSE review_requested_at END,
           approved_by = CASE WHEN ? = 'approved' THEN approved_by ELSE NULL END,
           approved_at = CASE WHEN ? = 'approved' THEN approved_at ELSE NULL END,
           updated_at = unixepoch() WHERE id = ?`,
      )
      .bind(draftId, input.status, input.status, input.status, input.status, draftId),
    ...(input.itemStatus
      ? [
          db
            .prepare(
              `UPDATE schedule_items SET status = ?, updated_at = unixepoch()
               WHERE id = (SELECT schedule_item_id FROM drafts WHERE id = ?)
                 AND status NOT IN ('dispatching','scheduled','done')`,
            )
            .bind(input.itemStatus, draftId),
        ]
      : []),
  ]);
  const version = inserted?.results?.[0]?.version;
  if (typeof version !== "number") throw new Error("draft version insert returned no version");
  return version;
}

export async function getDraft(
  db: D1Database,
  campaignId: number,
  id: number,
): Promise<Draft | null> {
  const row = await db
    .prepare("SELECT * FROM drafts WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .first<DraftRow>();
  return row ? toDraft(row) : null;
}

export async function getDraftById(db: D1Database, id: number): Promise<Draft | null> {
  const row = await db.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first<DraftRow>();
  return row ? toDraft(row) : null;
}

export async function draftForItem(db: D1Database, itemId: number): Promise<Draft | null> {
  const row = await db
    .prepare(
      "SELECT * FROM drafts WHERE schedule_item_id = ? AND status != 'superseded' ORDER BY id DESC LIMIT 1",
    )
    .bind(itemId)
    .first<DraftRow>();
  return row ? toDraft(row) : null;
}

export async function listDrafts(
  db: D1Database,
  campaignId: number,
  statuses?: DraftStatus[],
): Promise<(Draft & { mustFails: number })[]> {
  const filter = statuses?.length ? `AND d.status IN (${statuses.map(() => "?").join(",")})` : "";
  const { results } = await db
    .prepare(
      `SELECT d.*, v.check_results FROM drafts d
       LEFT JOIN draft_versions v ON v.draft_id = d.id AND v.version = d.current_version
       WHERE d.campaign_id = ? ${filter} ORDER BY d.updated_at DESC`,
    )
    .bind(campaignId, ...(statuses ?? []))
    .all<DraftRow & { check_results: string | null }>();
  return results.map((r) => ({
    ...toDraft(r),
    mustFails: (JSON.parse(r.check_results ?? "[]") as CheckResult[]).filter(
      (c) => c.strength === "MUST" && c.status === "fail",
    ).length,
  }));
}

export async function listVersions(db: D1Database, draftId: number): Promise<DraftVersion[]> {
  const { results } = await db
    .prepare("SELECT * FROM draft_versions WHERE draft_id = ? ORDER BY version DESC")
    .bind(draftId)
    .all<VersionRow>();
  return results.map(toVersion);
}

export async function latestVersion(db: D1Database, draftId: number): Promise<DraftVersion | null> {
  const row = await db
    .prepare("SELECT * FROM draft_versions WHERE draft_id = ? ORDER BY version DESC LIMIT 1")
    .bind(draftId)
    .first<VersionRow>();
  return row ? toVersion(row) : null;
}

export async function setDraftStatus(
  db: D1Database,
  draftId: number,
  from: DraftStatus,
  to: DraftStatus,
  itemStatus: string,
  by: { reviewedBy?: string; approvedBy?: string },
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE drafts SET status = ?, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = CASE WHEN ? IS NULL THEN reviewed_at ELSE unixepoch() END,
           approved_by = COALESCE(?, approved_by), approved_at = CASE WHEN ? IS NULL THEN approved_at ELSE unixepoch() END,
           updated_at = unixepoch()
         WHERE id = ? AND status = ?`,
      )
      .bind(
        to,
        by.reviewedBy ?? null,
        by.reviewedBy ?? null,
        by.approvedBy ?? null,
        by.approvedBy ?? null,
        draftId,
        from,
      ),
    db
      .prepare(
        `UPDATE schedule_items SET status = ?, updated_at = unixepoch()
         WHERE id = (SELECT schedule_item_id FROM drafts WHERE id = ? AND status = ?)
           AND status NOT IN ('dispatching','scheduled','done')`,
      )
      .bind(itemStatus, draftId, to),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

export async function addReview(
  db: D1Database,
  input: {
    draftId: number;
    version: number;
    userId: string;
    decision: DraftReview["decision"];
    stage: DraftReview["stage"];
    comment: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO draft_reviews (draft_id, version, user_id, decision, stage, comment) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(input.draftId, input.version, input.userId, input.decision, input.stage, input.comment)
    .run();
}

export async function listReviews(db: D1Database, draftId: number): Promise<DraftReview[]> {
  const { results } = await db
    .prepare("SELECT * FROM draft_reviews WHERE draft_id = ? ORDER BY created_at DESC, id DESC")
    .bind(draftId)
    .all<{
      id: number;
      version: number;
      user_id: string;
      decision: DraftReview["decision"];
      stage: DraftReview["stage"];
      comment: string | null;
      created_at: number;
    }>();
  return results.map((r) => ({
    id: r.id,
    version: r.version,
    userId: r.user_id,
    decision: r.decision,
    stage: r.stage,
    comment: r.comment,
    createdAt: r.created_at,
  }));
}

export async function updateDraftPeople(
  db: D1Database,
  draftId: number,
  people: { assigneeUserId: string | null; reviewerUserId: string | null },
): Promise<void> {
  await db
    .prepare(
      "UPDATE drafts SET assignee_user_id = ?, reviewer_user_id = ?, updated_at = unixepoch() WHERE id = ?",
    )
    .bind(people.assigneeUserId, people.reviewerUserId, draftId)
    .run();
}
