import type { CampaignTrendClick, LinkSourceClicks, TopRow } from "./analytics-engine";

export type CampaignAnalyticsChannel = {
  id: number;
  name: string;
  links: Array<{ id: string; slug?: string }>;
  sources: Array<{ code: string; name: string }>;
};

export type CampaignSourceRow = TopRow & { key: string };

export type UnregisteredCampaignSource = {
  channelId: number;
  channelName: string;
  code: string;
  clicks: number;
};

export function campaignSourceBreakdown(
  channels: CampaignAnalyticsChannel[],
  clicks: LinkSourceClicks[],
): { rows: CampaignSourceRow[]; unregistered: UnregisteredCampaignSource[] } {
  const channelByLinkId = new Map<string, CampaignAnalyticsChannel>();
  for (const channel of channels) {
    for (const link of channel.links) channelByLinkId.set(link.id, channel);
  }

  const totals = new Map<string, CampaignSourceRow>();
  const unregistered = new Map<string, UnregisteredCampaignSource>();
  for (const row of clicks) {
    const channel = channelByLinkId.get(row.linkId);
    if (!channel) continue;
    const source = channel.sources.find((candidate) => candidate.code === row.source);
    const label = row.source
      ? source
        ? `${channel.name} / ${source.name} (${row.source})`
        : `${channel.name} / ${row.source} (Unregistered)`
      : `${channel.name} / Direct / untagged`;
    const key = `${channel.id}\0${row.source}`;
    const current = totals.get(key);
    totals.set(key, {
      key: `source:${channel.id}:${row.source}`,
      name: label,
      clicks: (current?.clicks ?? 0) + row.clicks,
    });

    if (row.source && !source) {
      const missing = unregistered.get(key);
      unregistered.set(key, {
        channelId: channel.id,
        channelName: channel.name,
        code: row.source,
        clicks: (missing?.clicks ?? 0) + row.clicks,
      });
    }
  }

  return {
    rows: [...totals.values()].sort((a, b) => b.clicks - a.clicks),
    unregistered: [...unregistered.values()].sort((a, b) => b.clicks - a.clicks),
  };
}

export type CampaignTrendDimension = "total" | "channel" | "source" | "link";
export type CampaignTrendSeries = { key: string; label: string; clicks: number };
export type CampaignTrendPoint = { hour: string; [key: string]: string | number };

export function campaignTrendBreakdown(
  channels: CampaignAnalyticsChannel[],
  rows: CampaignTrendClick[],
  dimension: CampaignTrendDimension,
  focusKey?: string,
  maxSeries = 6,
): { points: CampaignTrendPoint[]; series: CampaignTrendSeries[] } {
  const channelByLinkId = new Map<string, CampaignAnalyticsChannel>();
  const linkById = new Map<string, CampaignAnalyticsChannel["links"][number]>();
  for (const channel of channels) {
    for (const link of channel.links) {
      channelByLinkId.set(link.id, channel);
      linkById.set(link.id, link);
    }
  }

  function identity(row: CampaignTrendClick): { key: string; label: string } | null {
    const channel = channelByLinkId.get(row.linkId);
    if (!channel) return null;
    if (dimension === "total") return { key: "total", label: "Clicks" };
    if (dimension === "channel") {
      return { key: `channel:${channel.id}`, label: channel.name };
    }
    if (dimension === "link") {
      const link = linkById.get(row.linkId);
      return { key: `link:${row.linkId}`, label: link?.slug ?? row.linkId };
    }
    const source = channel.sources.find((candidate) => candidate.code === row.source);
    const sourceLabel = row.source
      ? source
        ? `${channel.name} / ${source.name}`
        : `${channel.name} / ${row.source}`
      : `${channel.name} / Direct`;
    return { key: `source:${channel.id}:${row.source}`, label: sourceLabel };
  }

  const labels = new Map<string, string>();
  const totals = new Map<string, number>();
  const buckets = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const item = identity(row);
    if (!item || (focusKey && item.key !== focusKey)) continue;
    labels.set(item.key, item.label);
    totals.set(item.key, (totals.get(item.key) ?? 0) + row.clicks);
    const bucket = buckets.get(row.hour) ?? new Map<string, number>();
    bucket.set(item.key, (bucket.get(item.key) ?? 0) + row.clicks);
    buckets.set(row.hour, bucket);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const keepCount = ranked.length > maxSeries ? Math.max(1, maxSeries - 1) : ranked.length;
  const kept = ranked.slice(0, keepCount);
  const keptKeys = new Set(kept.map(([key]) => key));
  const hasOther = ranked.length > kept.length;
  const series: CampaignTrendSeries[] = kept.map(([key, clicks]) => ({
    key,
    label: labels.get(key) ?? key,
    clicks,
  }));
  if (hasOther) {
    series.push({
      key: "other",
      label: "Other",
      clicks: ranked.slice(keepCount).reduce((sum, [, clicks]) => sum + clicks, 0),
    });
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, bucket]) => {
      const point: CampaignTrendPoint = { hour };
      for (const item of series) point[item.key] = 0;
      for (const [key, clicks] of bucket) {
        if (keptKeys.has(key)) point[key] = clicks;
        else if (hasOther) point.other = Number(point.other ?? 0) + clicks;
      }
      return point;
    });

  return { points, series };
}
