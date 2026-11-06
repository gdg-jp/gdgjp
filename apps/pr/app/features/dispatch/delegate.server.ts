import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Draft } from "~/features/drafts/draft";
import { latestVersion } from "~/features/drafts/draft.repository.server";
import { linkForItem } from "~/features/links/link.repository.server";
import { withShortlink } from "~/features/links/slug";
import { notifyChapter, template } from "~/features/notify/send.server";
import { createDerivedItem, getItem } from "~/features/schedule/item.repository.server";
import { deliverablePost, jstLabel } from "./content";
import { type DispatchResult, skipTarget } from "./dispatch.server";
import { getTarget } from "./target.repository.server";

const DAY_MINUTES = 24 * 60;

/**
 * A co-host chapter's account with nobody here to approve it: a request item (with the text to
 * copy) and a message on that chapter's Discord, instead of posting for them.
 */
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
  const post = deliverablePost((await latestVersion(env.DB, draft.id))?.content ?? null);
  if (!item || !post) return { ok: true, message: "依頼に回しました" };
  const link = await linkForItem(env.DB, item.id);
  const text = withShortlink(post.text, link?.shortUrl ?? null);
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
