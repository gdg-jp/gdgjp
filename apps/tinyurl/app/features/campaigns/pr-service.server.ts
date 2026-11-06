import type { PrActor, PrRpcResult, TinyurlLinkSummary } from "@gdgjp/gdg-lib";
import { getDomainByHostname } from "~/features/domains/domain.repository";
import type { Link } from "~/features/links/link-record";
import { createLinkWithExtras, updateLinkWithExtras } from "~/features/links/link.service";
import { getCampaignAnalyticsForActor } from "./campaign-cli-analytics";
import { parseIdCursor } from "./campaign.repository";
import {
  createCampaignChannelForActor,
  createCampaignForActor,
  listCampaignChannelsForActor,
  listCampaignsForActor,
} from "./campaign.service";

/**
 * The calls pr.gdgs.jp makes through the PrService entrypoint (workers/app.ts). Every call goes
 * through the same *ForActor services the dashboard and CLI use, so permissions are tinyurl's.
 */
const fail = (code: string, message?: string) => ({ ok: false as const, code, message });

export async function prEnsureCampaign(
  env: Env,
  input: {
    actor: PrActor;
    chapterId: number;
    code: string;
    name: string;
    defaultDestinationUrl?: string | null;
  },
): Promise<PrRpcResult<{ campaignId: number; created: boolean }>> {
  const created = await createCampaignForActor(env.DB, input.actor, {
    name: input.name,
    code: input.code,
    defaultDestinationUrl: input.defaultDestinationUrl ?? null,
    chapterIds: [input.chapterId],
  });
  if (created.ok) return { ok: true, campaignId: created.campaign.id, created: true };
  if (created.code !== "conflict") return fail(created.code, created.error);
  let cursor: number | null = null;
  for (let i = 0; i < 20; i++) {
    const page = await listCampaignsForActor(env.DB, input.actor, {
      includeArchived: true,
      limit: 100,
      cursor,
    });
    const match = page.items.find((c) => c.code.toLowerCase() === input.code.toLowerCase());
    if (match) return { ok: true, campaignId: match.id, created: false };
    const next = page.nextCursor ? parseIdCursor(page.nextCursor) : undefined;
    if (next === undefined) break;
    cursor = next;
  }
  return fail("forbidden", "The campaign code exists but is not visible to this actor.");
}

export async function prEnsureChannel(
  env: Env,
  input: { actor: PrActor; campaignId: number; code: string; name: string },
): Promise<PrRpcResult<{ channelId: number; created: boolean }>> {
  const listed = await listCampaignChannelsForActor(env.DB, input.actor, input.campaignId, {
    includeArchived: true,
    limit: 200,
  });
  if (!listed.ok) return fail(listed.code, listed.error);
  const match = listed.page.items.find((c) => c.code.toLowerCase() === input.code.toLowerCase());
  if (match) return { ok: true, channelId: match.id, created: false };
  const created = await createCampaignChannelForActor(env.DB, input.actor, input.campaignId, {
    name: input.name,
    code: input.code,
  });
  return created.ok
    ? { ok: true, channelId: created.channel.id, created: true }
    : fail(created.code, created.error);
}

const summary = (env: Env, link: Link): TinyurlLinkSummary => ({
  id: link.id,
  slug: link.slug,
  shortUrl: `${(link.domainHostname ? `https://${link.domainHostname}` : env.SHORT_URL_BASE).replace(/\/$/, "")}/${link.slug}`,
});

export async function prCreateLink(
  env: Env,
  input: {
    actor: PrActor;
    chapterId: number;
    slug: string;
    destinationUrl: string;
    title?: string | null;
    ogImageUrl?: string | null;
    campaignChannelId: number | null;
  },
): Promise<PrRpcResult<{ link: TinyurlLinkSummary }>> {
  const domain = await getDomainByHostname(env.DB, new URL(env.SHORT_URL_BASE).host);
  if (!domain) return fail("not_found", "The short-link system domain is missing.");
  const created = await createLinkWithExtras(
    { db: env.DB },
    { user: input.actor.user, chapters: input.actor.chapters, selectedChapterId: input.chapterId },
    {
      domainId: domain.id,
      chapterId: input.chapterId,
      slug: input.slug,
      destinationUrl: input.destinationUrl,
      title: input.title ?? null,
      ogImageUrl: input.ogImageUrl ?? null,
      campaignChannelId: input.campaignChannelId,
      visibility: "private",
    },
  );
  return created.ok
    ? { ok: true, link: summary(env, { ...created.link, domainHostname: domain.hostname }) }
    : fail(created.code, created.error);
}

export async function prUpdateLink(
  env: Env,
  input: { actor: PrActor; linkId: string; ogImageUrl?: string | null; destinationUrl?: string },
): Promise<PrRpcResult<{ link: TinyurlLinkSummary }>> {
  const patch: Record<string, unknown> = {};
  if (input.ogImageUrl !== undefined) patch.ogImageUrl = input.ogImageUrl;
  if (input.destinationUrl !== undefined) patch.destinationUrl = input.destinationUrl;
  const updated = await updateLinkWithExtras(
    { db: env.DB },
    { user: input.actor.user, chapters: input.actor.chapters, selectedChapterId: null },
    input.linkId,
    patch,
  );
  return updated.ok
    ? { ok: true, link: summary(env, updated.link) }
    : fail(updated.code, updated.error);
}

export async function prGetAnalytics(
  env: Env,
  input: { actor: PrActor; campaignId: number; from: string; to: string; bucket?: "hour" | "day" },
): Promise<PrRpcResult<{ analytics: unknown }>> {
  const result = await getCampaignAnalyticsForActor(env, input.actor, input.campaignId, {
    from: input.from,
    to: input.to,
    bucket: input.bucket,
  });
  return result.ok ? { ok: true, analytics: result.analytics } : fail(result.code, result.error);
}
