import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";
import { diffLeaves, ruleHints } from "./edits";

export async function recordEdits(
  db: D1Database,
  input: {
    campaignId: number;
    draftId?: number | null;
    assetId?: number | null;
    fromVersion: number;
    toVersion: number;
    kind: string;
    before: unknown;
    after: unknown;
    beforeChecks?: CheckResult[];
    afterChecks?: CheckResult[];
    userId: string;
  },
): Promise<number> {
  const edits = diffLeaves(input.before, input.after);
  if (!edits.length) return 0;
  const hints = JSON.stringify(ruleHints(input.beforeChecks ?? [], input.afterChecks ?? []));
  await db.batch(
    edits.map((e) =>
      db
        .prepare(
          `INSERT INTO draft_edits (campaign_id, draft_id, asset_id, from_version, to_version, kind, field, before, after, char_distance, rule_hints, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.campaignId,
          input.draftId ?? null,
          input.assetId ?? null,
          input.fromVersion,
          input.toVersion,
          input.kind,
          e.field,
          e.before,
          e.after,
          e.charDistance,
          hints,
          input.userId,
        ),
    ),
  );
  return edits.length;
}

export type EditGroup = {
  key: string;
  kind: string;
  field: string;
  count: number;
  ruleHints: string[];
  examples: { before: string | null; after: string | null }[];
  recurring: boolean;
};

const groupField = (field: string) => field.replace(/\/\d+(?=\/|$)/g, "/*");

export async function editGroups(
  db: D1Database,
  campaignId: number,
  chapterId: number,
): Promise<EditGroup[]> {
  const { results } = await db
    .prepare(
      "SELECT kind, field, before, after, rule_hints FROM draft_edits WHERE campaign_id = ? ORDER BY id",
    )
    .bind(campaignId)
    .all<{
      kind: string;
      field: string;
      before: string | null;
      after: string | null;
      rule_hints: string;
    }>();
  const { results: others } = await db
    .prepare(
      `SELECT DISTINCT e.kind, e.field FROM draft_edits e JOIN campaigns c ON c.id = e.campaign_id
       WHERE c.chapter_id = ? AND e.campaign_id != ?`,
    )
    .bind(chapterId, campaignId)
    .all<{ kind: string; field: string }>();
  const seen = new Set(others.map((o) => `${o.kind} ${groupField(o.field)}`));
  const groups = new Map<string, EditGroup>();
  for (const r of results) {
    const field = groupField(r.field);
    const key = `${r.kind} ${field}`;
    const g = groups.get(key) ?? {
      key,
      kind: r.kind,
      field,
      count: 0,
      ruleHints: [],
      examples: [],
      recurring: seen.has(key),
    };
    g.count++;
    for (const hint of JSON.parse(r.rule_hints) as string[])
      if (!g.ruleHints.includes(hint)) g.ruleHints.push(hint);
    if (g.examples.length < 3) g.examples.push({ before: r.before, after: r.after });
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
