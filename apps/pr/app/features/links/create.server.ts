import type { PrActor } from "@gdgjp/gdg-lib";
import type { Campaign } from "~/features/campaigns/campaign";
import type { DeliverablePost } from "~/features/dispatch/content";
import { logDispatch } from "~/features/dispatch/log.server";
import { callRpc, tinyurlService } from "~/features/integrations/bindings.server";
import type { ScheduleItem } from "~/features/schedule/item";
import type { CampaignLink } from "./link";
import { campaignChannelId, insertLink, linkForItem } from "./link.repository.server";
import { shortlinkSlug } from "./slug";

/**
 * One short link per schedule item, created on url.gdgs.jp (tinyurl) as the approver. The draft
 * keeps `{{shortlink}}`; delivery substitutes this link's URL.
 */
export async function ensureShortlink(
  env: Env,
  actor: PrActor,
  campaign: Campaign,
  item: ScheduleItem,
  post: DeliverablePost,
  fallbackUrl: string | null,
): Promise<{ ok: true; link: CampaignLink } | { ok: false; error: string }> {
  const existing = await linkForItem(env.DB, item.id);
  if (existing) return { ok: true, link: existing };
  if (!campaign.tinyurlCampaignId)
    return { ok: false, error: "短縮リンクを作るには、設定でキャンペーンを有効化してください" };
  const destinationUrl = post.linkUrl ?? fallbackUrl;
  if (!destinationUrl) return { ok: false, error: "短縮リンクの宛先がありません" };
  const slug = shortlinkSlug(campaign.slug, item.kind, item.id);
  const channelId = await campaignChannelId(env.DB, campaign.id, item.channel);
  const result = await callRpc(() =>
    tinyurlService(env).createLink({
      actor,
      chapterId: campaign.chapterId,
      slug,
      destinationUrl,
      title: item.title,
      ogImageUrl: post.ogImage,
      campaignChannelId: channelId,
    }),
  );
  await logDispatch(env.DB, {
    campaignId: campaign.id,
    itemId: item.id,
    action: "link_create",
    ok: result.ok,
    detail: result.ok ? result.link.shortUrl : `${result.code}: ${result.message ?? ""}`,
  });
  if (!result.ok) return { ok: false, error: `短縮リンクを作れませんでした（${result.code}）` };
  await insertLink(env.DB, {
    campaignId: campaign.id,
    scheduleItemId: item.id,
    tinyurlLinkId: result.link.id,
    shortUrl: result.link.shortUrl,
    slug: result.link.slug,
    destinationUrl,
    channel: item.channel,
    ogImageUrl: post.ogImage,
  });
  const saved = await linkForItem(env.DB, item.id);
  return saved
    ? { ok: true, link: saved }
    : { ok: false, error: "短縮リンクを保存できませんでした" };
}
