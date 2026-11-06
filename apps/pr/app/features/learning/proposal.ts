export type ProposalKind = "rule" | "constant" | "guide" | "template" | "example" | "decision";
export type ProposalStatus = "proposed" | "accepted" | "rejected" | "applied";
export type ProposalOrigin = "retro" | "human" | "analyze";

export type Proposal = {
  id: string;
  chapterId: number;
  campaignId: number | null;
  origin: ProposalOrigin;
  kind: ProposalKind;
  target: string;
  summary: string;
  observation: string;
  evidence: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: ProposalStatus;
  decidedBy: string | null;
  decisionReason: string | null;
  exportedAt: number | null;
  appliedPlaybookVersion: string | null;
  playbookVersion: string;
  createdAt: number;
};

export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  "rule",
  "constant",
  "guide",
  "template",
  "example",
  "decision",
];
export const KIND_LABELS: Record<ProposalKind, string> = {
  rule: "ルール",
  constant: "定数",
  guide: "ガイド",
  template: "テンプレート",
  example: "事例",
  decision: "決定",
};
export const STATUS_LABELS: Record<ProposalStatus, string> = {
  proposed: "提案",
  accepted: "採用",
  rejected: "却下",
  applied: "適用済み",
};

/** A sortable, unique id (time + randomness), so proposals list in creation order. */
export function proposalId(now = Date.now()): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `p${now.toString(36)}${rand}`;
}

/** The export bundle feedback.mjs imports (one file per accepted proposal on disk). */
export function exportBundle(proposals: Proposal[], digests: { rules: string; constants: string }) {
  return {
    format: "pr-playbook-proposals/1",
    exportedAt: new Date().toISOString(),
    baseRevision: digests,
    proposals: proposals.map((p) => ({
      id: p.id,
      kind: p.kind,
      target: p.target,
      summary: p.summary,
      observation: p.observation,
      evidence: p.evidence,
      payload: p.payload,
      origin: p.origin,
      playbookVersion: p.playbookVersion,
      decisionReason: p.decisionReason,
    })),
  };
}
