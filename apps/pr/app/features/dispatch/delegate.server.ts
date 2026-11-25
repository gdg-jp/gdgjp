import type { CampaignAccess } from "~/features/campaigns/access.server";
import { type Draft, approvedForSending } from "~/features/drafts/draft";
import { latestVersion } from "~/features/drafts/draft.repository.server";
import { actorOf } from "~/features/integrations/bindings.server";
import { versionText } from "~/features/links/create.server";
import { notifyChapter, template } from "~/features/notify/send.server";
import type { ScheduleItem } from "~/features/schedule/item";
import { createDerivedItem, getItem } from "~/features/schedule/item.repository.server";
import { deliverablePost, jstLabel } from "./content";
import { type DispatchResult, skipTarget } from "./dispatch.server";
import { getTarget } from "./target.repository.server";

const DAY_MINUTES = 24 * 60;

async function delegatedText(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  item: ScheduleItem,
): Promise<string | null> {
  if (approvedForSending(draft) && draft.approvedVersion !== null) {
    const at = { draftId: draft.id, version: draft.approvedVersion };
    const text = await versionText(env, actorOf(access), access.campaign, item, at);
    if (text.ok) return text.text;
  }
  return deliverablePost((await latestVersion(env.DB, draft.id))?.content ?? null)?.text ?? null;
}

export async function delegateTarget(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  targetId: number,
): Promise<DispatchResult> {
  const skipped = await skipTarget(env, access, draft, targetId, "delegated");
  if (!skipped.ok) return skipped;
  const item = draft.scheduleItemId
    ? await getItem(env.DB, access.campaign.id, draft.scheduleItemId)
    : null;
  if (!item) return { ok: true, message: "依頼に回しました" };
  const text = await delegatedText(env, access, draft, item);
  if (!text) return { ok: true, message: "依頼に回しました" };
  const at = jstLabel(item.dueAt);
  const content = template("delegated", { mention: "", account: skipped.targetLabel, at, text });
  const now = Math.floor(Date.now() / 1000);
  await createDerivedItem(
    env.DB,
    access.campaign.id,
    {
      kind: "community_ask",
      channel: item.channel,
      dueAt: Math.max(now, item.dueAt - DAY_MINUTES * 60),
      title: `${skipped.targetLabel} での投稿の依頼`,
      note: content,
      assigneeUserId: access.user.id,
      requiresApproval: false,
      offsetMinutes: -DAY_MINUTES,
    },
    item.id,
  );
  const account = (await getTarget(env.DB, targetId))?.account;
  if (account)
    await notifyChapter(env, {
      chapterId: account.chapterId,
      campaignId: access.campaign.id,
      itemId: item.id,
      key: `delegated:${targetId}`,
      content,
      action: "discord_delegated",
    });
  return { ok: true, message: `${skipped.targetLabel} への依頼を作りました` };
}
