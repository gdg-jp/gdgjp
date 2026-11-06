import type { Proposal, ProposalKind, ProposalOrigin, ProposalStatus } from "./proposal";
import { proposalId } from "./proposal";

type Row = {
  id: string;
  chapter_id: number;
  campaign_id: number | null;
  origin: ProposalOrigin;
  kind: ProposalKind;
  target: string;
  summary: string;
  observation: string;
  evidence: string;
  payload: string;
  status: ProposalStatus;
  decided_by: string | null;
  decision_reason: string | null;
  exported_at: number | null;
  applied_playbook_version: string | null;
  playbook_version: string;
  created_at: number;
};

const toProposal = (r: Row): Proposal => ({
  id: r.id,
  chapterId: r.chapter_id,
  campaignId: r.campaign_id,
  origin: r.origin,
  kind: r.kind,
  target: r.target,
  summary: r.summary,
  observation: r.observation,
  evidence: JSON.parse(r.evidence || "{}"),
  payload: JSON.parse(r.payload || "{}"),
  status: r.status,
  decidedBy: r.decided_by,
  decisionReason: r.decision_reason,
  exportedAt: r.exported_at,
  appliedPlaybookVersion: r.applied_playbook_version,
  playbookVersion: r.playbook_version,
  createdAt: r.created_at,
});

export async function insertProposal(
  db: D1Database,
  p: Pick<
    Proposal,
    | "chapterId"
    | "campaignId"
    | "origin"
    | "kind"
    | "target"
    | "summary"
    | "observation"
    | "evidence"
    | "payload"
    | "playbookVersion"
  >,
): Promise<string> {
  const id = proposalId();
  await db
    .prepare(
      `INSERT INTO playbook_proposals (id, chapter_id, campaign_id, origin, kind, target, summary, observation, evidence, payload, playbook_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      p.chapterId,
      p.campaignId,
      p.origin,
      p.kind,
      p.target,
      p.summary,
      p.observation,
      JSON.stringify(p.evidence),
      JSON.stringify(p.payload),
      p.playbookVersion,
    )
    .run();
  return id;
}

export async function listProposals(
  db: D1Database,
  chapterIds: number[],
  filter: { status?: string; kind?: string } = {},
): Promise<Proposal[]> {
  if (!chapterIds.length) return [];
  const where = [`chapter_id IN (${chapterIds.map(() => "?").join(",")})`];
  const binds: unknown[] = [...chapterIds];
  if (filter.status) {
    where.push("status = ?");
    binds.push(filter.status);
  }
  if (filter.kind) {
    where.push("kind = ?");
    binds.push(filter.kind);
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM playbook_proposals WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 200`,
    )
    .bind(...binds)
    .all<Row>();
  return results.map(toProposal);
}

export async function getProposal(db: D1Database, id: string): Promise<Proposal | null> {
  const row = await db
    .prepare("SELECT * FROM playbook_proposals WHERE id = ?")
    .bind(id)
    .first<Row>();
  return row ? toProposal(row) : null;
}

export async function decideProposal(
  db: D1Database,
  id: string,
  status: "accepted" | "rejected",
  userId: string,
  reason: string,
) {
  const r = await db
    .prepare(
      "UPDATE playbook_proposals SET status = ?, decided_by = ?, decided_at = unixepoch(), decision_reason = ? WHERE id = ? AND status = 'proposed'",
    )
    .bind(status, userId, reason, id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function markApplied(db: D1Database, id: string, version: string) {
  await db
    .prepare(
      "UPDATE playbook_proposals SET status = 'applied', applied_playbook_version = ? WHERE id = ? AND status = 'accepted'",
    )
    .bind(version, id)
    .run();
}

export async function markExported(db: D1Database, ids: string[]) {
  if (!ids.length) return;
  await db
    .prepare(
      `UPDATE playbook_proposals SET exported_at = unixepoch() WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .run();
}
