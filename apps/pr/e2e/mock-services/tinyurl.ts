import { WorkerEntrypoint } from "cloudflare:workers";
import type { PrActor } from "@gdgjp/gdg-lib";

const campaigns = new Map<string, { id: number; chapterId: number; name: string }>();
const channels = new Map<string, { id: number; campaignId: number; code: string }>();
const RUN = Date.now().toString(36);
type Origin = { campaignId: number; draftId: number; version: number };
const links = new Map<
  string,
  {
    id: string;
    slug: string;
    destinationUrl: string;
    campaignChannelId: number | null;
    ownerUserId: string;
    origin: string | null;
    originChapterId: number | null;
  }
>();
const attempts: { slug: string; destinationUrl: string; origin: string | null; result: string }[] =
  [];
const originKey = (origin?: Origin) =>
  origin ? `pr:${origin.campaignId}:${origin.draftId}:${origin.version}` : null;

const inChapter = (actor: PrActor, chapterId: number) =>
  actor.user.isAdmin || actor.chapters.some((c) => c.chapterId === chapterId);

function createOrAdopt(
  input: {
    actor: PrActor;
    chapterId: number;
    slug: string;
    destinationUrl: string;
    campaignChannelId: number | null;
  },
  origin: string | null,
) {
  const summary = (link: { id: string; slug: string }) => ({
    id: link.id,
    slug: link.slug,
    shortUrl: `https://gdgs.jp/${link.slug}`,
  });
  const same = origin ? [...links.values()].find((l) => l.origin === origin) : undefined;
  if (same) {
    if (same.originChapterId !== input.chapterId) return { ok: false as const, code: "not_found" };
    if (
      same.destinationUrl !== input.destinationUrl ||
      same.campaignChannelId !== input.campaignChannelId
    )
      return { ok: false as const, code: "origin_mismatch" };
    return { ok: true as const, adopted: true, link: summary(same) };
  }
  if (!inChapter(input.actor, input.chapterId)) return { ok: false as const, code: "forbidden" };
  if ([...links.values()].some((l) => l.slug === input.slug))
    return { ok: false as const, code: "slug_taken" };
  const id = `link-${RUN}-${links.size + 1}`;
  links.set(id, {
    id,
    slug: input.slug,
    destinationUrl: input.destinationUrl,
    campaignChannelId: input.campaignChannelId,
    ownerUserId: input.actor.user.id,
    origin,
    originChapterId: origin ? input.chapterId : null,
  });
  return { ok: true as const, adopted: false, link: summary({ id, slug: input.slug }) };
}

export class PrService extends WorkerEntrypoint {
  ensureCampaign(input: { actor: PrActor; chapterId: number; code: string; name: string }) {
    if (!inChapter(input.actor, input.chapterId)) return { ok: false as const, code: "forbidden" };
    const existing = campaigns.get(input.code);
    if (existing) return { ok: true as const, campaignId: existing.id, created: false };
    const id = campaigns.size + 1;
    campaigns.set(input.code, { id, chapterId: input.chapterId, name: input.name });
    return { ok: true as const, campaignId: id, created: true };
  }
  ensureChannel(input: { actor: PrActor; campaignId: number; code: string }) {
    const key = `${input.campaignId}:${input.code}`;
    const existing = channels.get(key);
    if (existing) return { ok: true as const, channelId: existing.id, created: false };
    const id = channels.size + 1;
    channels.set(key, { id, campaignId: input.campaignId, code: input.code });
    return { ok: true as const, channelId: id, created: true };
  }
  createLink(input: {
    actor: PrActor;
    chapterId: number;
    slug: string;
    destinationUrl: string;
    campaignChannelId: number | null;
    approvedVersion?: Origin;
  }) {
    const origin = originKey(input.approvedVersion);
    const result = createOrAdopt(input, origin);
    attempts.push({
      slug: input.slug,
      destinationUrl: input.destinationUrl,
      origin,
      result: result.ok ? (result.adopted ? "adopted" : "created") : result.code,
    });
    return result;
  }
  updateLink() {
    return { ok: false as const, code: "not_implemented" };
  }
  getAnalytics() {
    return {
      ok: true as const,
      analytics: {
        totalClicks: 120,
        trend: [],
        links: [],
        sources: [
          {
            channelId: 1,
            channelName: "X（投稿）",
            sourceCode: "x_post",
            sourceName: null,
            clicks: 80,
          },
          {
            channelId: 2,
            channelName: "GDG の Discord",
            sourceCode: null,
            sourceName: null,
            clicks: 40,
          },
        ],
        acquisition: null,
      },
    };
  }
  mockState() {
    return {
      campaigns: [...campaigns.entries()],
      channels: [...channels.values()],
      links: [...links.values()],
      attempts,
    };
  }
}

export default { fetch: () => new Response("mock gdgjp-tinyurl") };
