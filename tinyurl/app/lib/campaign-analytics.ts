import type { LinkSourceClicks, TopRow } from "./analytics-engine";

export type CampaignAnalyticsChannel = {
  id: number;
  name: string;
  links: Array<{ id: string }>;
  sources: Array<{ code: string; name: string }>;
};

export type UnregisteredCampaignSource = {
  channelId: number;
  channelName: string;
  code: string;
  clicks: number;
};

export function campaignSourceBreakdown(
  channels: CampaignAnalyticsChannel[],
  clicks: LinkSourceClicks[],
): { rows: TopRow[]; unregistered: UnregisteredCampaignSource[] } {
  const channelByLinkId = new Map<string, CampaignAnalyticsChannel>();
  for (const channel of channels) {
    for (const link of channel.links) channelByLinkId.set(link.id, channel);
  }

  const totals = new Map<string, { name: string; clicks: number }>();
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
    totals.set(key, { name: label, clicks: (current?.clicks ?? 0) + row.clicks });

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
