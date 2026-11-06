import { mustFailures } from "@skills/pr-playbook/scripts/checks/index.mjs";
import { listAssets } from "~/features/assets/asset.repository.server";
import { xIgSplit } from "~/features/budget/flight";
import { listFlights, updateFlight } from "~/features/budget/flight.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { listMembers } from "~/features/campaigns/campaign.repository.server";
import { appendVersion, createDraft } from "~/features/drafts/draft.repository.server";
import type { CompleteOutcome } from "~/features/jobs/complete.server";
import { EnqueueError, enqueueAsset } from "~/features/jobs/enqueue.server";
import { insertJob, openJobs } from "~/features/jobs/job.repository.server";
import type { Job } from "~/features/jobs/shared";
import { dashboard } from "~/features/metrics/dashboard.server";
import { adoptedPlan } from "~/features/plans/plan.repository.server";
import { constants, PLAYBOOK_VERSION } from "~/features/playbook/playbook";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { createItem, listItems, updateItem } from "~/features/schedule/item.repository.server";
import { isScheduleKind } from "~/features/schedule/kinds";
import type { AnalyzeReport } from "./report";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function enqueueAnalyze(db: D1Database, campaignId: number, userId: string | null) {
  if ((await openJobs(db, campaignId, "analyze")).length)
    throw new EnqueueError("分析のジョブがもう動いています");
  const weekOf = new Date().toISOString().slice(0, 10);
  return insertJob(db, {
    campaignId,
    payload: { type: "analyze", weekOf },
    requestedBy: userId,
    priority: -5,
  });
}

/** Weekly (Monday 02:00 JST): one analyze job per active campaign. */
export async function enqueueWeeklyAnalyses(env: Env) {
  const { results } = await env.DB.prepare("SELECT id FROM campaigns WHERE status = 'active'").all<{
    id: number;
  }>();
  let queued = 0;
  for (const c of results) {
    try {
      await enqueueAnalyze(env.DB, c.id, null);
      queued++;
    } catch (error) {
      if (!(error instanceof EnqueueError)) throw error;
    }
  }
  return { queued };
}

/** The analyze bundle: the numbers the dashboard shows, flights, plan, the next 14 days, the team. */
export async function analyzeFiles(
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
  files["METRICS.json"] = json(await dashboard(env, access));
  files["AD_FLIGHTS.json"] = json(await listFlights(env.DB, campaign.id));
  const plan = await adoptedPlan(env.DB, campaign.id);
  if (plan) files["PLAN.json"] = json(plan.body);
  const now = Math.floor(Date.now() / 1000);
  const items = await listItems(env.DB, campaign.id);
  files["SCHEDULE.json"] = json(
    items
      .filter((i) => i.dueAt >= now - 7 * 86400 && i.dueAt <= now + 14 * 86400)
      .map((i) => ({
        itemId: i.id,
        kind: i.kind,
        title: i.title,
        at: `${jstDate(i.dueAt)} ${jstTime(i.dueAt)}`,
        status: i.status,
        assignee: i.assigneeUserId,
        blockedBy: i.blockedBy,
        requestStatus: i.requestStatus,
      })),
  );
  files["TEAM.json"] = json(
    members.map((m) => ({ userId: m.userId, name: m.name, roles: m.roles })),
  );
  files["ASSETS.json"] = json(
    (await listAssets(env.DB, campaign.id))
      .filter((a) => a.status === "approved")
      .map((a) => ({ assetId: a.id, templateId: a.templateId, slots: a.slots })),
  );
  task.push(
    "METRICS.json ほかから、今週の集客を分析して週次 MTG のレポートと提案を作る。提案は人が適用する。",
  );
}

/** Saved as a `report` draft; a reallocation outside the Playbook's X : IG range is flagged. */
export async function importReport(
  env: Env,
  job: Job,
  output: AnalyzeReport,
): Promise<CompleteOutcome> {
  const by = output.budgetReallocation.byMedium;
  const split = xIgSplit(
    [
      { medium: "x_ads", plannedYen: by.x_ads, actualYen: null },
      { medium: "ig_ads", plannedYen: by.ig_ads, actualYen: null },
    ],
    constants.budget.xIgRatioRange,
    "plannedYen",
  );
  const checks = [
    {
      ruleId: "BUDGET-SPLIT",
      strength: "MUST" as const,
      status: split.inRange === false ? ("fail" as const) : ("pass" as const),
      detail: split.share === null ? "" : `X ${Math.round(split.share * 100)}%`,
    },
  ];
  const draftId = await createDraft(env.DB, {
    campaignId: job.campaignId,
    kind: "report",
    title: `週次レポート ${String((job.payload as { weekOf?: string }).weekOf ?? "")}`,
    scheduleItemId: null,
  });
  await appendVersion(env.DB, draftId, {
    author: "agent",
    userId: null,
    jobId: job.id,
    content: output,
    playbookVersion: PLAYBOOK_VERSION,
    checkResults: checks,
    status: "in_review",
    itemStatus: "in_review",
  });
  return {
    status: "succeeded",
    summary: { draftIds: [draftId], mustFails: mustFailures({ results: checks } as never).length },
  };
}

/** A person applies one proposal; nothing is applied automatically. */
export async function applyProposal(
  env: Env,
  access: CampaignAccess,
  report: AnalyzeReport,
  form: FormData,
) {
  const intent = String(form.get("intent"));
  const index = Number(form.get("index"));
  if (intent === "apply-budget") {
    const flights = await listFlights(env.DB, access.campaign.id);
    for (const medium of ["x_ads", "ig_ads", "print"] as const) {
      const group = flights.filter((f) => f.medium === medium);
      const before = group.reduce((n, f) => n + f.plannedYen, 0);
      const after = report.budgetReallocation.byMedium[medium];
      for (const f of group)
        await updateFlight(env.DB, access.campaign.id, f.id, {
          plannedYen: before
            ? Math.round((f.plannedYen * after) / before)
            : Math.round(after / group.length),
        });
    }
    return { ok: true, message: "広告フライトの計画額を書き換えました" };
  }
  if (intent === "apply-schedule") {
    const change = report.scheduleChanges[index];
    if (!change) return { ok: false, errors: ["提案がありません"] };
    const dueAt = change.dueAt ? Math.floor(Date.parse(change.dueAt) / 1000) : null;
    if (change.action === "add") {
      if (!change.kind || !isScheduleKind(change.kind) || !dueAt || !change.title)
        return { ok: false, errors: ["追加に要る項目が足りません"] };
      await createItem(
        env.DB,
        access.campaign.id,
        { kind: change.kind, dueAt, title: change.title, note: change.reason },
        null,
      );
    } else if (change.itemId) {
      await updateItem(
        env.DB,
        access.campaign.id,
        change.itemId,
        change.action === "drop" ? { status: "skipped" } : { dueAt: dueAt ?? undefined },
      );
    }
    return { ok: true, message: "スケジュールに反映しました" };
  }
  if (intent === "apply-creative") {
    const change = report.creativeChanges[index];
    if (!change) return { ok: false, errors: ["提案がありません"] };
    await enqueueAsset(env.DB, access.campaign.id, access.user.id, {
      templateId: change.templateId,
      instructions: `${change.reason}\n${change.slotHints}`,
    });
    return { ok: true, message: "画像のジョブを積みました" };
  }
  return null;
}
