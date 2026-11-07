import { parseBrief } from "~/features/briefs/brief";
import { latestBrief, saveBrief } from "~/features/briefs/brief.repository.server";
import { getCampaignById, updateCampaign } from "~/features/campaigns/campaign.repository.server";
import type { CompleteOutcome } from "~/features/jobs/complete.server";
import { insertJob, openJobs } from "~/features/jobs/job.repository.server";
import type { Job } from "~/features/jobs/shared";
import { listPlans } from "~/features/plans/plan.repository.server";
import { listItems } from "~/features/schedule/item.repository.server";
import { assistantSettings } from "~/features/settings/chapter-settings.server";
import { AUTO_ACTIONS, type RawAction, sanitizeActions } from "./actions";
import { runAction } from "./actions.server";
import type { MessageAction } from "./message";
import { insertMessage } from "./message.repository.server";
import { briefGaps } from "./state";

export type AssistOutput = {
  reply: string;
  briefJson: string | null;
  briefChanges: string[];
  questions: string[];
  actions: RawAction[];
};

/**
 * The assistant's reply: save the brief it rewrote (validated against the Playbook's schema; one
 * retry with the errors), keep only buttons the Worker can run, press the internal ones itself
 * when the chapter allows, and post the message.
 */
export async function importAssist(
  env: Env,
  job: Job,
  output: AssistOutput,
): Promise<CompleteOutcome> {
  const db = env.DB;
  const campaign = await getCampaignById(db, job.campaignId);
  if (!campaign) return { status: "failed", summary: {}, error: "campaign gone" };
  const payload = job.payload as { upTo?: number; briefErrors?: string[] };
  const previous = await latestBrief(db, campaign.id);
  const meta: { briefVersion?: number; briefChanges?: string[]; errors?: string[] } = {};
  let saved = false;
  if (output.briefJson) {
    let candidate: unknown = null;
    let errors: string[] = [];
    try {
      candidate = JSON.parse(output.briefJson);
    } catch {
      errors = ["briefJson が JSON として読めない"];
    }
    const parsed = errors.length ? null : parseBrief(candidate);
    if (parsed && !parsed.ok) errors = parsed.errors;
    if (errors.length && !payload.briefErrors) {
      await insertJob(db, {
        campaignId: campaign.id,
        payload: { type: "assist", upTo: payload.upTo ?? 0, briefErrors: errors.slice(0, 20) },
        requestedBy: job.requestedBy,
      });
      return { status: "succeeded", summary: { retried: true, briefErrors: errors.length } };
    }
    if (errors.length) meta.errors = errors.slice(0, 10);
    else if (parsed?.ok && JSON.stringify(parsed.brief) !== JSON.stringify(previous?.brief)) {
      meta.briefVersion = await saveBrief(db, campaign.id, parsed.brief, "agent");
      meta.briefChanges = output.briefChanges.slice(0, 20);
      saved = true;
      if (parsed.brief.event.name && parsed.brief.event.name !== campaign.name)
        await updateCampaign(db, campaign.id, { name: parsed.brief.event.name.slice(0, 120) });
    }
  }

  const items = await listItems(db, campaign.id);
  let actions = sanitizeActions(output.actions, {
    base: `/c/${campaign.slug}`,
    itemIds: new Set(items.map((i) => i.id)),
  });
  const brief = saved
    ? ((await latestBrief(db, campaign.id))?.brief ?? null)
    : (previous?.brief ?? null);
  const ready = briefGaps(brief).length === 0;
  const plans = await listPlans(db, campaign.id);
  // The first time the brief is complete, a plan is the obvious next step.
  if (
    ready &&
    !plans.length &&
    !actions.some((a) => a.type === "run_plan") &&
    !(await openJobs(db, campaign.id, "plan")).length
  )
    actions.unshift({ type: "run_plan", label: "計画を作る", status: "proposed" });
  if (!ready) actions = actions.filter((a) => a.type !== "run_plan");
  if (saved && previous)
    actions.push({
      type: "revert_brief",
      label: "brief を元に戻す",
      briefVersion: previous.version,
      status: "proposed",
    });

  const settings = await assistantSettings(db, campaign.chapterId);
  if (settings.mode === "auto" && job.requestedBy) {
    const ran: MessageAction[] = [];
    for (const action of actions)
      ran.push(
        AUTO_ACTIONS.includes(action.type)
          ? await runAction(env, campaign, action, { userId: job.requestedBy, canManage: false })
          : action,
      );
    actions = ran;
  }

  const id = await insertMessage(db, {
    campaignId: campaign.id,
    author: "assistant",
    body: meta.errors
      ? `${output.reply}\n\n（brief は形が合わず保存できませんでした。もう一度頼むか、brief の画面で直してください）`
      : output.reply,
    questions: output.questions.slice(0, 3),
    actions,
    meta,
    jobId: job.id,
  });
  return {
    status: "succeeded",
    summary: { messageId: id, briefVersion: meta.briefVersion ?? null },
  };
}
