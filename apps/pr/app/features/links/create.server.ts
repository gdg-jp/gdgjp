import type { PrActor } from "@gdgjp/gdg-lib";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { type DeliverablePost, NO_TINYURL, deliverablePost } from "~/features/dispatch/content";
import { logDispatch } from "~/features/dispatch/log.server";
import { getVersion } from "~/features/drafts/draft.repository.server";
import { callRpc, tinyurlService } from "~/features/integrations/bindings.server";
import type { ScheduleItem } from "~/features/schedule/item";
import type { CampaignLink, LinkVersion } from "./link";
import { campaignChannelId, insertVersionLink, linkForVersion } from "./link.repository.server";
import { hasShortlink, shortlinkSlug, withShortlink } from "./slug";

export const NO_CONTENT = "配信する本文がありません";

const SLUG_TAKEN = ["conflict", "slug_taken"];

export type VersionText =
  | { ok: true; post: DeliverablePost; text: string; link: CampaignLink | null }
  | { ok: false; error: string };

export const fallbackUrl = async (db: D1Database, campaignId: number) =>
  (await latestBrief(db, campaignId))?.brief.event.connpassUrl ?? null;

export async function versionText(
  env: Env,
  actor: PrActor | null,
  campaign: Campaign,
  item: ScheduleItem,
  at: LinkVersion,
): Promise<VersionText> {
  const post = deliverablePost((await getVersion(env.DB, at.draftId, at.version))?.content ?? null);
  if (!post) return { ok: false, error: NO_CONTENT };
  if (!hasShortlink(post.text)) return { ok: true, post, text: post.text, link: null };
  const link = await ensureVersionLink(env, actor, campaign, item, at, post);
  return link.ok
    ? { ok: true, post, text: withShortlink(post.text, link.link.shortUrl), link: link.link }
    : link;
}

async function ensureVersionLink(
  env: Env,
  actor: PrActor | null,
  campaign: Campaign,
  item: ScheduleItem,
  at: LinkVersion,
  post: DeliverablePost,
): Promise<{ ok: true; link: CampaignLink } | { ok: false; error: string }> {
  const existing = await linkForVersion(env.DB, at);
  if (existing) return { ok: true, link: existing };
  if (!campaign.tinyurlCampaignId) return { ok: false, error: NO_TINYURL };
  if (!actor) return { ok: false, error: "承認者の情報が無いので短縮リンクを作れません" };
  const destinationUrl = post.linkUrl ?? (await fallbackUrl(env.DB, campaign.id));
  if (!destinationUrl) return { ok: false, error: "短縮リンクの宛先がありません" };
  const slug = shortlinkSlug(campaign.slug, item.kind, at);
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
    detail: result.ok
      ? `v${at.version} ${result.link.shortUrl}`
      : `v${at.version} ${slug} ${result.code}: ${result.message ?? ""}`,
  });
  if (result.ok)
    await insertVersionLink(env.DB, at, {
      campaignId: campaign.id,
      tinyurlLinkId: result.link.id,
      shortUrl: result.link.shortUrl,
      slug: result.link.slug,
      destinationUrl,
      channel: item.channel,
      ogImageUrl: post.ogImage,
    });
  const saved = await linkForVersion(env.DB, at);
  if (saved) return { ok: true, link: saved };
  return result.ok || !SLUG_TAKEN.includes(result.code)
    ? { ok: false, error: `短縮リンクを作れませんでした（${result.ok ? "保存" : result.code}）` }
    : {
        ok: false,
        error: `短縮リンク ${slug} は url.gdgs.jp にありますが pr に記録がありません。url.gdgs.jp で消してからもう一度承認してください`,
      };
}
