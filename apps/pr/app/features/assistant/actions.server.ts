import { briefVersion, saveBrief } from "~/features/briefs/brief.repository.server";
import type { Campaign, CampaignMember } from "~/features/campaigns/campaign";
import { listMembers } from "~/features/campaigns/campaign.repository.server";
import { EnqueueError, enqueueDrafts, enqueuePlan } from "~/features/jobs/enqueue.server";
import { adoptPlan } from "~/features/plans/adopt.server";
import { listPlans } from "~/features/plans/plan.repository.server";
import { updateItem } from "~/features/schedule/item.repository.server";
import type { MessageAction } from "./message";

/** Run one button. Returns the action with its new status and a short result for the thread. */
export async function runAction(
  env: Env,
  campaign: Campaign,
  action: MessageAction,
  actor: { userId: string; canManage: boolean; members?: CampaignMember[] },
): Promise<MessageAction> {
  const done = (result: string): MessageAction => ({ ...action, status: "done", result });
  const failed = (result: string): MessageAction => ({ ...action, status: "failed", result });
  const db = env.DB;
  try {
    switch (action.type) {
      case "run_plan":
        await enqueuePlan(db, campaign.id, actor.userId, action.instructions ?? undefined);
        return done("計画を作り始めました");
      case "draft_items": {
        const jobs = await enqueueDrafts(
          db,
          campaign.id,
          actor.userId,
          action.scheduleItemIds ?? [],
          action.instructions ?? undefined,
        );
        return done(`下書きを作り始めました（${jobs.length} 件のジョブ）`);
      }
      case "adopt_plan": {
        if (!actor.canManage) return failed("採用できるのはリードとオーガナイザーです");
        const plan = action.planVersion
          ? { version: action.planVersion }
          : (await listPlans(db, campaign.id))[0];
        if (!plan) return failed("計画がありません");
        const members = actor.members ?? (await listMembers(db, campaign.id));
        const result = await adoptPlan(db, campaign.id, plan.version, members);
        return done(`計画（版 ${plan.version}）を採用し、予定を ${result.created} 件入れました`);
      }
      case "move_item": {
        const id = action.scheduleItemIds?.[0];
        const at = action.dueAt ? Math.floor(Date.parse(action.dueAt) / 1000) : Number.NaN;
        if (!id || Number.isNaN(at)) return failed("予定か時刻が読めません");
        await updateItem(db, campaign.id, id, { dueAt: at });
        return done("予定の時刻を変えました");
      }
      case "revert_brief": {
        if (!actor.canManage) return failed("brief を戻せるのはリードとオーガナイザーです");
        const stored = action.briefVersion
          ? await briefVersion(db, campaign.id, action.briefVersion)
          : null;
        if (!stored) return failed("その版がありません");
        const version = await saveBrief(db, campaign.id, stored.brief, actor.userId);
        return done(`brief を版 ${stored.version} の内容に戻しました（版 ${version}）`);
      }
      default:
        return action;
    }
  } catch (error) {
    if (error instanceof EnqueueError) return failed(error.message);
    if (error instanceof Response) return failed(`できませんでした（${error.status}）`);
    throw error;
  }
}
