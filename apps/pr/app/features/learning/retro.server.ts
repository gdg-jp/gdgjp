import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { listMembers } from "~/features/campaigns/campaign.repository.server";
import {
  appendVersion,
  createDraft,
  latestVersion,
  listDrafts,
} from "~/features/drafts/draft.repository.server";
import type { CompleteOutcome } from "~/features/jobs/complete.server";
import { EnqueueError } from "~/features/jobs/enqueue.server";
import { insertJob, openJobs } from "~/features/jobs/job.repository.server";
import type { Job } from "~/features/jobs/shared";
import { dashboard } from "~/features/metrics/dashboard.server";
import { adoptedPlan } from "~/features/plans/plan.repository.server";
import { PLAYBOOK_VERSION } from "~/features/playbook/playbook";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { listItems } from "~/features/schedule/item.repository.server";
import { personalData } from "./edits";
import { editGroups } from "./edits.server";
import type { ProposalKind } from "./proposal";
import { insertProposal } from "./proposal.repository.server";

export type RetroOutput = {
  reportMd: string;
  proposals: {
    kind: ProposalKind;
    target: string;
    summary: string;
    observation: string;
    evidence: { editGroupKeys: string[]; metricRefs: string[]; retroNoteRefs: string[] };
    payloadJson: string;
  }[];
  examples: {
    kind: string;
    draftVersionId: number | null;
    assetId: number | null;
    why: string;
    metrics: string;
  }[];
  contactOutcomes: {
    contactId: number;
    outcome: "worked" | "no_response" | "declined";
    note: string;
  }[];
  wikiOutreachUpdateMd: string;
  provisionalUpdates: { path: string; valueJson: string; evidence: string }[];
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function enqueueRetro(db: D1Database, campaignId: number, userId: string | null) {
  if ((await openJobs(db, campaignId, "retro")).length)
    throw new EnqueueError("振り返りのジョブがもう動いています");
  return insertJob(db, {
    campaignId,
    payload: { type: "retro" },
    requestedBy: userId,
    priority: -10,
  });
}

export async function setRetroNotes(db: D1Database, campaignId: number, notes: string) {
  await db
    .prepare("UPDATE campaigns SET retro_notes_md = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(notes || null, campaignId)
    .run();
}

export async function retroNotes(db: D1Database, campaignId: number): Promise<string> {
  const row = await db
    .prepare("SELECT retro_notes_md FROM campaigns WHERE id = ?")
    .bind(campaignId)
    .first<{ retro_notes_md: string | null }>();
  return row?.retro_notes_md ?? "";
}

/** What the retro reads: grouped edits (with recurrences), outcomes, reviews, KPT notes, decisions. */
export async function retroFiles(
  env: Env,
  campaign: Campaign,
  files: Record<string, string>,
  task: string[],
) {
  const members = await listMembers(env.DB, campaign.id);
  const access = {
    campaign,
    members,
    user: { id: "runner" },
    chapters: [],
  } as unknown as CampaignAccess;
  const groups = await editGroups(env.DB, campaign.id, campaign.chapterId);
  files["EDITS.json"] = json({
    groups,
    recurring: groups.filter((g) => g.recurring).map((g) => g.key),
  });
  files["METRICS.json"] = json(await dashboard(env, access));
  const plan = await adoptedPlan(env.DB, campaign.id);
  if (plan) files["PLAN.json"] = json(plan.body);
  files["SCHEDULE_OUTCOME.json"] = json(
    (await listItems(env.DB, campaign.id)).map((i) => ({
      itemId: i.id,
      kind: i.kind,
      title: i.title,
      at: `${jstDate(i.dueAt)} ${jstTime(i.dueAt)}`,
      status: i.status,
      requestStatus: i.requestStatus,
    })),
  );
  const { results: reviews } = await env.DB.prepare(
    `SELECT d.kind, r.decision, r.comment FROM draft_reviews r JOIN drafts d ON d.id = r.draft_id
     WHERE d.campaign_id = ? AND r.comment IS NOT NULL ORDER BY r.created_at`,
  )
    .bind(campaign.id)
    .all<{ kind: string; decision: string; comment: string }>();
  files["REVIEWS.json"] = json(reviews);
  const { results: contacts } = await env.DB.prepare(
    "SELECT id, organization, kind, channel, outcomes FROM contacts WHERE last_used_campaign_id = ?",
  )
    .bind(campaign.id)
    .all();
  files["CONTACTS_USED.json"] = json(contacts);
  const reports = (await listDrafts(env.DB, campaign.id)).filter((d) => d.kind === "report");
  const analyses: string[] = [];
  for (const d of reports) {
    const content = (await latestVersion(env.DB, d.id))?.content as { reportMd?: string } | null;
    if (content?.reportMd) analyses.push(`# ${d.title}\n\n${content.reportMd}`);
  }
  files["ANALYZE_REPORTS.md"] = `${analyses.join("\n\n---\n\n")}\n`;
  files["RETRO_NOTES.md"] = `${await retroNotes(env.DB, campaign.id)}\n`;
  task.push(
    "このキャンペーンを振り返り、Playbook への提案と、Wiki の告知先表に貼る更新を出す。根拠は EDITS.json・指標・RETRO_NOTES.md に置く。",
  );
}

/**
 * The retro's report (a `report` draft), its proposals (personal data refused), contact outcomes
 * appended to contacts, and observed values for provisional constants as constant proposals.
 * The Wiki update is shown for a person to paste: pr never writes the Wiki.
 */
export async function importRetro(
  env: Env,
  job: Job,
  output: RetroOutput,
): Promise<CompleteOutcome> {
  const campaign = await env.DB.prepare("SELECT chapter_id FROM campaigns WHERE id = ?")
    .bind(job.campaignId)
    .first<{ chapter_id: number }>();
  if (!campaign) return { status: "failed", summary: {}, error: "campaign not found" };
  const refused: string[] = [];
  const base = {
    chapterId: campaign.chapter_id,
    campaignId: job.campaignId,
    origin: "retro" as const,
    playbookVersion: PLAYBOOK_VERSION,
  };
  let saved = 0;
  for (const p of output.proposals) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(p.payloadJson || "{}");
    } catch {
      refused.push(`${p.summary}: payloadJson が JSON でない`);
      continue;
    }
    const pii = personalData(`${p.summary}\n${p.observation}\n${p.payloadJson}`);
    if (pii.length) {
      refused.push(`${p.summary}: 個人を特定できる値（${pii.length} 件）`);
      continue;
    }
    await insertProposal(env.DB, {
      ...base,
      kind: p.kind,
      target: p.target,
      summary: p.summary,
      observation: p.observation,
      evidence: p.evidence,
      payload,
    });
    saved++;
  }
  for (const e of output.examples) {
    const content = e.draftVersionId
      ? ((
          await env.DB.prepare("SELECT content FROM draft_versions WHERE id = ?")
            .bind(e.draftVersionId)
            .first<{ content: string }>()
        )?.content ?? null)
      : null;
    if (personalData(`${content ?? ""}\n${e.why}`).length) {
      refused.push(`事例 ${e.kind}: 個人を特定できる値`);
      continue;
    }
    await insertProposal(env.DB, {
      ...base,
      kind: "example",
      target: `examples/${e.kind}`,
      summary: e.why.slice(0, 80),
      observation: e.why,
      evidence: { draftVersionId: e.draftVersionId, assetId: e.assetId },
      payload: {
        kind: e.kind,
        content: content ? JSON.parse(content) : null,
        metrics: e.metrics,
        why: e.why,
      },
    });
    saved++;
  }
  for (const u of output.provisionalUpdates) {
    let value: unknown;
    try {
      value = JSON.parse(u.valueJson);
    } catch {
      continue;
    }
    await insertProposal(env.DB, {
      ...base,
      kind: "constant",
      target: `constants.json#${u.path}`,
      summary: `${u.path} の観察値`,
      observation: u.evidence,
      evidence: { text: u.evidence },
      payload: { path: u.path, value },
    });
    saved++;
  }
  for (const c of output.contactOutcomes) {
    await env.DB.prepare(
      `UPDATE contacts SET outcomes = json_insert(outcomes, '$[#]', json(?)), updated_at = unixepoch() WHERE id = ? AND chapter_id = ?`,
    )
      .bind(
        JSON.stringify({ campaignId: job.campaignId, outcome: c.outcome, note: c.note }),
        c.contactId,
        campaign.chapter_id,
      )
      .run();
  }
  const draftId = await createDraft(env.DB, {
    campaignId: job.campaignId,
    kind: "report",
    title: "振り返り",
    scheduleItemId: null,
  });
  await appendVersion(env.DB, draftId, {
    author: "agent",
    userId: null,
    jobId: job.id,
    content: {
      retro: true,
      reportMd: output.reportMd,
      wikiOutreachUpdateMd: output.wikiOutreachUpdateMd,
      refused,
    },
    playbookVersion: PLAYBOOK_VERSION,
    checkResults: [],
    status: "in_review",
    itemStatus: "in_review",
  });
  return {
    status: "succeeded",
    summary: { draftIds: [draftId], proposals: saved, refused: refused.length },
  };
}
