// Local stand-in for gdgjp-tinyurl's PrService (vite.config.ts auxiliaryWorkers, dev only).
import { WorkerEntrypoint } from "cloudflare:workers";
import type { PrActor } from "@gdgjp/gdg-lib";

const campaigns = new Map<string, { id: number; chapterId: number; name: string }>();
const channels = new Map<string, { id: number; campaignId: number; code: string }>();
// Ids stay unique across dev-server restarts (pr keeps them in D1).
const RUN = Date.now().toString(36);
const links = new Map<
  string,
  { id: string; slug: string; destinationUrl: string; campaignChannelId: number | null }
>();

const inChapter = (actor: PrActor, chapterId: number) =>
  actor.user.isAdmin || actor.chapters.some((c) => c.chapterId === chapterId);

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
  }) {
    if (!inChapter(input.actor, input.chapterId)) return { ok: false as const, code: "forbidden" };
    if ([...links.values()].some((l) => l.slug === input.slug))
      return { ok: false as const, code: "slug_taken" };
    const id = `link-${RUN}-${links.size + 1}`;
    links.set(id, {
      id,
      slug: input.slug,
      destinationUrl: input.destinationUrl,
      campaignChannelId: input.campaignChannelId,
    });
    return {
      ok: true as const,
      link: { id, slug: input.slug, shortUrl: `https://gdgs.jp/${input.slug}` },
    };
  }
  updateLink() {
    return { ok: false as const, code: "not_implemented" };
  }
  getAnalytics() {
    return { ok: true as const, analytics: { buckets: [] } };
  }
  mockState() {
    return {
      campaigns: [...campaigns.entries()],
      channels: [...channels.values()],
      links: [...links.values()],
    };
  }
}

export default { fetch: () => new Response("mock gdgjp-tinyurl") };
