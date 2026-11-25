import type {
  PrActor,
  PrRpcResult,
  TinyurlApprovedVersion,
  TinyurlLinkSummary,
  TinyurlPrService,
} from "@gdgjp/gdg-lib";
import { getDomainByHostname } from "~/features/domains/domain.repository";
import { listPermissionsForLink } from "~/features/links/link-permissions.repository";
import { canEditLinkForChapters } from "~/features/links/link-policy";
import type { Link } from "~/features/links/link-record";
import {
  type PrLinkOrigin,
  getLinkByPrOrigin,
  getLinkWithoutPrOrigin,
  updateLinkOgImage,
  updatePrOriginLinkOgImage,
} from "~/features/links/link.repository";
import { createLinkWithExtras } from "~/features/links/link.service";
import { validatePublicHttpUrl } from "~/features/links/ogp";
import { getCampaignAnalyticsForActor } from "./campaign-cli-analytics";
import { parseIdCursor } from "./campaign.repository";
import {
  createCampaignChannelForActor,
  createCampaignForActor,
  listCampaignChannelsForActor,
  listCampaignsForActor,
} from "./campaign.service";

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

type PrCreateLinkInput = Parameters<TinyurlPrService["createLink"]>[0];

const originKey = (origin: TinyurlApprovedVersion) =>
  [origin.campaignId, origin.draftId, origin.version].every((n) => Number.isInteger(n) && n > 0)
    ? `pr:${origin.campaignId}:${origin.draftId}:${origin.version}`
    : null;

export async function prCreateLink(
  env: Env,
  input: PrCreateLinkInput,
): Promise<PrRpcResult<{ link: TinyurlLinkSummary; adopted?: boolean }>> {
  const domain = await getDomainByHostname(env.DB, new URL(env.SHORT_URL_BASE).host);
  if (!domain) return fail("not_found", "The short-link system domain is missing.");
  const key = input.approvedVersion ? originKey(input.approvedVersion) : null;
  if (input.approvedVersion && !key)
    return fail("invalid_input", "The approved version is invalid.");
  const origin = key ? { key, chapterId: input.chapterId } : undefined;
  if (origin) {
    const adopted = await adoptByOrigin(env, input, origin);
    if (adopted) return adopted;
  }
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
    origin,
  );
  if (created.ok)
    return { ok: true, link: summary(env, { ...created.link, domainHostname: domain.hostname }) };
  const raced =
    origin && created.code === "conflict" ? await adoptByOrigin(env, input, origin) : null;
  return raced ?? fail(created.code, created.error);
}

async function adoptByOrigin(
  env: Env,
  input: PrCreateLinkInput,
  origin: PrLinkOrigin,
): Promise<PrRpcResult<{ link: TinyurlLinkSummary; adopted: true }> | null> {
  const link = await getLinkByPrOrigin(env.DB, origin.key);
  if (!link) return null;
  if (link.prOriginChapterId !== origin.chapterId)
    return fail("not_found", "No link was made for this approved version in this chapter.");
  if (
    link.destinationUrl !== input.destinationUrl ||
    link.campaignChannelId !== input.campaignChannelId
  )
    return fail("origin_mismatch", "A link with this origin has another destination or channel.");
  return { ok: true, link: summary(env, link), adopted: true };
}

const LINK_NOT_FOUND = "Link not found.";

export async function prUpdateLink(
  env: Env,
  input: Parameters<TinyurlPrService["updateLink"]>[0],
): Promise<PrRpcResult<{ link: TinyurlLinkSummary }>> {
  const ogImageUrl = input.ogImageUrl ?? null;
  if (ogImageUrl) {
    const valid = await validatePublicHttpUrl(ogImageUrl);
    if (!valid.ok) return fail("invalid_input", `OG image ${valid.reason}`);
  }
  const scoped = await updatePrOriginLinkOgImage(
    env.DB,
    { id: input.linkId, chapterId: input.chapterId },
    ogImageUrl,
  );
  if (scoped) return { ok: true, link: summary(env, scoped) };
  const legacy = await getLinkWithoutPrOrigin(env.DB, input.linkId);
  if (
    !legacy ||
    !canEditLinkForChapters(
      input.actor.user,
      input.actor.chapters.map((chapter) => chapter.chapterId),
      legacy,
      await listPermissionsForLink(env.DB, legacy.id),
    )
  )
    return fail("not_found", LINK_NOT_FOUND);
  const updated = await updateLinkOgImage(env.DB, legacy.id, ogImageUrl);
  return updated ? { ok: true, link: summary(env, updated) } : fail("not_found", LINK_NOT_FOUND);
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
