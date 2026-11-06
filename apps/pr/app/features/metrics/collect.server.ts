import { getActorSnapshot } from "~/features/campaigns/campaign.repository.server";
import { logDispatch } from "~/features/dispatch/log.server";
import {
  callRpc,
  connpassService,
  parseActor,
  tinyurlService,
} from "~/features/integrations/bindings.server";
import { addSnapshot } from "./snapshot.repository.server";

/**
 * Hourly, active campaigns only: tinyurl analytics and connpass stats, as the person who
 * activated the campaign. Aggregates only; failures go to the dispatch log.
 */
export async function collectMetrics(env: Env): Promise<{ campaigns: number; snapshots: number }> {
  const { results } = await env.DB.prepare(
    "SELECT id, tinyurl_campaign_id, connpass_group_slug, connpass_event_id, created_at FROM campaigns WHERE status = 'active'",
  ).all<{
    id: number;
    tinyurl_campaign_id: number | null;
    connpass_group_slug: string | null;
    connpass_event_id: string | null;
    created_at: number;
  }>();
  let snapshots = 0;
  for (const c of results) {
    const actor = parseActor(await getActorSnapshot(env.DB, c.id));
    if (!actor) {
      await logDispatch(env.DB, {
        campaignId: c.id,
        itemId: null,
        action: "metrics",
        ok: false,
        detail: "no_actor",
      });
      continue;
    }
    if (c.tinyurl_campaign_id) {
      const tinyurlId = c.tinyurl_campaign_id;
      const analytics = await callRpc(() =>
        tinyurlService(env).getAnalytics({
          actor,
          campaignId: tinyurlId,
          from: new Date(c.created_at * 1000).toISOString(),
          to: new Date().toISOString(),
          bucket: "day",
        }),
      );
      if (analytics.ok) {
        const a = analytics.analytics as { links?: unknown[] } & Record<string, unknown>;
        await addSnapshot(env.DB, {
          campaignId: c.id,
          source: "tinyurl",
          payload: { ...a, links: (a.links ?? []).slice(0, 10) },
        });
        snapshots++;
      } else
        await logDispatch(env.DB, {
          campaignId: c.id,
          itemId: null,
          action: "metrics_tinyurl",
          ok: false,
          detail: analytics.code,
        });
    }
    if (c.connpass_group_slug && c.connpass_event_id) {
      const groupSlug = c.connpass_group_slug;
      const eventId = c.connpass_event_id;
      const stats = await callRpc(() =>
        connpassService(env).getStats({ actor, groupSlug, eventId }),
      );
      if (stats.ok) {
        const s = stats.statistics as Record<string, number>;
        await addSnapshot(env.DB, {
          campaignId: c.id,
          source: "connpass_stats",
          payload: {
            applications: s.registeredCount ?? 0,
            waitlisted: s.waitlistedCount ?? 0,
            canceled: s.canceledCount ?? 0,
            attended: s.checkedInCount ?? 0,
          },
        });
        snapshots++;
      } else
        await logDispatch(env.DB, {
          campaignId: c.id,
          itemId: null,
          action: "metrics_connpass",
          ok: false,
          detail: stats.code,
        });
    }
  }
  return { campaigns: results.length, snapshots };
}
