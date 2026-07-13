import type { LinkSourceClicks, TopRow } from "./analytics-engine";

export type CampaignAnalyticsMedium = {
  id: number;
  name: string;
  links: Array<{ id: string }>;
  sources: Array<{ code: string; name: string }>;
};

export type UnregisteredCampaignSource = {
  mediaId: number;
  mediaName: string;
  code: string;
  clicks: number;
};

export function campaignSourceBreakdown(
  media: CampaignAnalyticsMedium[],
  clicks: LinkSourceClicks[],
): { rows: TopRow[]; unregistered: UnregisteredCampaignSource[] } {
  const mediumByLinkId = new Map<string, CampaignAnalyticsMedium>();
  for (const medium of media) {
    for (const link of medium.links) mediumByLinkId.set(link.id, medium);
  }

  const totals = new Map<string, { name: string; clicks: number }>();
  const unregistered = new Map<string, UnregisteredCampaignSource>();
  for (const row of clicks) {
    const medium = mediumByLinkId.get(row.linkId);
    if (!medium) continue;
    const source = medium.sources.find((candidate) => candidate.code === row.source);
    const label = row.source
      ? source
        ? `${medium.name} / ${source.name} (${row.source})`
        : `${medium.name} / ${row.source} (Unregistered)`
      : `${medium.name} / Direct / untagged`;
    const key = `${medium.id}\0${row.source}`;
    const current = totals.get(key);
    totals.set(key, { name: label, clicks: (current?.clicks ?? 0) + row.clicks });

    if (row.source && !source) {
      const missing = unregistered.get(key);
      unregistered.set(key, {
        mediaId: medium.id,
        mediaName: medium.name,
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
