import type { PrActor } from "@gdgjp/gdg-lib";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { type DeliverablePost, NO_TINYURL, deliverablePost } from "~/features/dispatch/content";
import { logDispatch } from "~/features/dispatch/log.server";
import { getVersion } from "~/features/drafts/draft.repository.server";
import { callRpc, tinyurlService } from "~/features/integrations/bindings.server";
import type { ScheduleItem } from "~/features/schedule/item";
import type { CampaignLink, LinkVersion } from "./link";
import {
  campaignChannelId,
  insertVersionLink,
  linkForVersion,
  unbindLink,
} from "./link.repository.server";
import { hasShortlink, shortlinkSlug, withShortlink } from "./slug";

export const NO_CONTENT = "配信する本文がありません";

const REFUSED = ["conflict", "slug_taken", "origin_mismatch", "not_found"];

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
  if (existing && (post.linkUrl === null || existing.destinationUrl === post.linkUrl))
    return { ok: true, link: existing };
  if (!campaign.tinyurlCampaignId) return { ok: false, error: NO_TINYURL };
  if (!actor) return { ok: false, error: "承認者の情報が無いので短縮リンクを作れません" };
  const destinationUrl = post.linkUrl ?? (await fallbackUrl(env.DB, campaign.id));
  if (!destinationUrl) return { ok: false, error: "短縮リンクの宛先がありません" };
  if (existing) await unbindLink(env.DB, existing.id);
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
      origin: { campaignId: campaign.id, draftId: at.draftId, version: at.version },
    }),
  );
  const adopted = result.ok && result.adopted === true;
  await logDispatch(env.DB, {
    campaignId: campaign.id,
    itemId: item.id,
    action: adopted ? "link_adopt" : "link_create",
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
  if (saved && saved.destinationUrl === destinationUrl) return { ok: true, link: saved };
  if (result.ok) return { ok: false, error: "短縮リンクを作れませんでした（保存）" };
  return {
    ok: false,
    error: REFUSED.includes(result.code)
      ? `短縮リンク ${slug} は url.gdgs.jp でほかの宛先か持ち主に使われているので送りません（${result.code}）`
      : `短縮リンクを作れませんでした（${result.code}）`,
  };
}
