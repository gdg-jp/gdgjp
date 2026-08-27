import {
  type HourlyPoint,
  type TimeBucket,
  clicksByLinkId,
  clicksByLinkIdAndSource,
  hourlyClicks,
  totalClicks,
} from "~/lib/analytics-engine";
import type { AnalyticsWindow } from "~/lib/analytics-filters";
import { campaignAcquisitionAnalytics } from "~/lib/campaign-acquisition";
import { getCampaignParticipantAnalytics } from "~/lib/campaign-participant-analytics-db";
import { type FeatureFailure, featureFailure } from "../shared/errors";
import { listCampaignChannelsWithLinks } from "./campaign.repository";
import type { CampaignServiceActor } from "./campaign.service";
import { loadCampaignForActor } from "./campaign.service";

const MAX_RANGE_DAYS = 366;
const MAX_HOURLY_RANGE_DAYS = 31;
const TOP_N = 10;

export type CampaignAnalyticsQuery = {
  from: string;
  to: string;
  bucket?: "hour" | "day";
  channelId?: number;
  linkId?: string;
  includeAutomated?: boolean;
};

export type CampaignAnalyticsLinkRow = { linkId: string; slug: string; clicks: number };

export type CampaignAnalyticsSourceRow = {
  channelId: number;
  channelName: string;
  sourceCode: string | null;
  sourceName: string | null;
  clicks: number;
};

export type CampaignAnalyticsAcquisition = {
  applications: number;
  cancellations: number;
  attendanceRate: number | null;
  channels: Array<{ name: string; count: number }>;
};

export type CampaignAnalytics = {
  totalClicks: number;
  trend: HourlyPoint[];
  links: CampaignAnalyticsLinkRow[];
  sources: CampaignAnalyticsSourceRow[];
  acquisition: CampaignAnalyticsAcquisition | null;
};

/**
 * `Date.parse`/`new Date(string)` silently normalizes out-of-range calendar
 * fields (e.g. Feb 30 rolls into Mar) and accepts many non-instant partial
 * strings, so it can't stand in for validation on its own. Requires the
 * `Z`-suffixed instant form (matching how every other window in this app is
 * UTC), and re-checks the parsed components against the input to reject
 * rollover.
 */
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;

export function parseIsoInstant(value: string): Date | null {
  const match = ISO_INSTANT_RE.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }
  return date;
}

export function aggregateAcquisition(
  snapshot: Awaited<ReturnType<typeof getCampaignParticipantAnalytics>>,
  channels: Array<{ id: number; name: string }>,
  window: AnalyticsWindow,
  bucket: TimeBucket,
): CampaignAnalyticsAcquisition | null {
  if (!snapshot) return null;
  const aggregate = campaignAcquisitionAnalytics({ snapshot, channels, window, bucket });
  return {
    applications: aggregate.summary.applications,
    cancellations: aggregate.summary.cancellations,
    attendanceRate: aggregate.summary.attendanceRate,
    channels: aggregate.channels
      .map((channel) => ({ name: channel.name, count: channel.count }))
      .slice(0, TOP_N),
  };
}

/**
 * The CLI contract takes `from`/`to` as ISO instants, but the shared
 * Analytics Engine window helpers only support whole-UTC-day custom ranges
 * (matching the dashboard's date-picker windows) — instants are validated
 * for correctness here, then truncated to their UTC date for the query.
 */
export async function getCampaignAnalyticsForActor(
  env: Env,
  actor: CampaignServiceActor,
  campaignId: number,
  query: CampaignAnalyticsQuery,
): Promise<{ ok: true; analytics: CampaignAnalytics } | FeatureFailure> {
  const loaded = await loadCampaignForActor(env.DB, actor, campaignId);
  if (!loaded.ok) return loaded;

  const fromDate = parseIsoInstant(query.from);
  const toDate = parseIsoInstant(query.to);
  if (!fromDate || !toDate) {
    return featureFailure(
      "invalid_input",
      "from and to must be ISO instants (e.g. 2026-01-01T00:00:00Z).",
    );
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return featureFailure("invalid_input", "from must not be after to.");
  }
  const startIso = fromDate.toISOString().slice(0, 10);
  const endIso = toDate.toISOString().slice(0, 10);
  const rangeDays =
    Math.floor(
      (Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    return featureFailure("invalid_input", `The date range cannot exceed ${MAX_RANGE_DAYS} days.`);
  }

  const bucketUnit = query.bucket ?? "day";
  if (bucketUnit !== "hour" && bucketUnit !== "day") {
    return featureFailure("invalid_input", "bucket must be hour or day.");
  }
  if (bucketUnit === "hour" && rangeDays > MAX_HOURLY_RANGE_DAYS) {
    return featureFailure(
      "invalid_input",
      `An hourly bucket is only available for ranges up to ${MAX_HOURLY_RANGE_DAYS} days.`,
    );
  }

  const channels = await listCampaignChannelsWithLinks(env.DB, campaignId, true);
  let channelsInScope = channels;
  if (query.channelId !== undefined) {
    channelsInScope = channels.filter((channel) => channel.id === query.channelId);
    if (channelsInScope.length === 0) {
      return featureFailure("invalid_input", "channelId does not belong to this campaign.");
    }
  }
  const allLinkIds = channelsInScope.flatMap((channel) => channel.links.map((link) => link.id));
  let linkIds = allLinkIds;
  if (query.linkId !== undefined) {
    if (!allLinkIds.includes(query.linkId)) {
      return featureFailure("invalid_input", "linkId does not belong to this campaign.");
    }
    linkIds = [query.linkId];
  }

  const window: AnalyticsWindow = { kind: "custom", startIso, endIso };
  const bucket: TimeBucket = { amount: 1, unit: bucketUnit };
  const opts = { window, bucket, includeAutomated: query.includeAutomated };
  const channelIdentities = channelsInScope.map((channel) => ({
    id: channel.id,
    name: channel.name,
  }));

  // Acquisition comes from the D1 participant snapshot, not Analytics
  // Engine, so it's independent of whether this campaign has any links (or
  // any clicks) — it must not be skipped just because linkIds is empty.
  if (linkIds.length === 0) {
    const snapshot = await getCampaignParticipantAnalytics(env.DB, campaignId);
    return {
      ok: true,
      analytics: {
        totalClicks: 0,
        trend: [],
        links: [],
        sources: [],
        acquisition: aggregateAcquisition(snapshot, channelIdentities, window, bucket),
      },
    };
  }

  const [total, trend, perLink, perLinkSource, snapshot] = await Promise.all([
    totalClicks(env, linkIds, opts),
    hourlyClicks(env, linkIds, opts),
    clicksByLinkId(env, linkIds, opts),
    clicksByLinkIdAndSource(env, linkIds, opts),
    getCampaignParticipantAnalytics(env.DB, campaignId),
  ]);

  const slugByLinkId = new Map<string, string>();
  const channelByLinkId = new Map<string, (typeof channelsInScope)[number]>();
  for (const channel of channelsInScope) {
    for (const link of channel.links) {
      slugByLinkId.set(link.id, link.slug);
      channelByLinkId.set(link.id, channel);
    }
  }

  const links: CampaignAnalyticsLinkRow[] = [...perLink.entries()]
    .map(([linkId, clicks]) => ({ linkId, slug: slugByLinkId.get(linkId) ?? linkId, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, TOP_N);

  const sourceTotals = new Map<string, CampaignAnalyticsSourceRow>();
  for (const row of perLinkSource) {
    const channel = channelByLinkId.get(row.linkId);
    if (!channel) continue;
    const source = channel.sources.find((candidate) => candidate.code === row.source) ?? null;
    const key = `${channel.id}\0${row.source}`;
    const current = sourceTotals.get(key);
    sourceTotals.set(key, {
      channelId: channel.id,
      channelName: channel.name,
      sourceCode: row.source || null,
      sourceName: source?.name ?? null,
      clicks: (current?.clicks ?? 0) + row.clicks,
    });
  }
  const sources = [...sourceTotals.values()].sort((a, b) => b.clicks - a.clicks).slice(0, TOP_N);

  return {
    ok: true,
    analytics: {
      totalClicks: total,
      trend,
      links,
      sources,
      acquisition: aggregateAcquisition(snapshot, channelIdentities, window, bucket),
    },
  };
}
