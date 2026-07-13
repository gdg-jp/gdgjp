import type { CampaignTrendClick } from "~/lib/analytics-engine";
import type { AnalyticsWindow } from "~/lib/analytics-filters";
import type { CampaignParticipantAnalyticsSnapshot } from "~/lib/campaign-participant-analytics-db";

const ATTRIBUTION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

type CampaignChannel = {
  id: number;
  name: string;
  links: Array<{ id: string }>;
};

export type CampaignConversionChannel = {
  channelId: number;
  name: string;
  clicks: number;
  estimatedRegistrations: number;
  contributionPercent: number;
  conversionRate: number;
};

export type CampaignConversionAttribution = {
  connpassEventId: string;
  updatedAt: string;
  registrations: number;
  attributedRegistrations: number;
  attributionPercent: number;
  conversionRate: number;
  channels: CampaignConversionChannel[];
  discoveryChannels: Array<{ name: string; count: number }>;
};

function timestamp(value: string): number | null {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function startOfToDate(window: Extract<AnalyticsWindow, { kind: "toDate" }>, now: Date): number {
  const year = now.getUTCFullYear();
  if (window.unit === "year") return Date.UTC(year, 0, 1);
  const month = now.getUTCMonth();
  if (window.unit === "quarter") return Date.UTC(year, Math.floor(month / 3) * 3, 1);
  return Date.UTC(year, month, 1);
}

function isWithinWindow(value: number, window: AnalyticsWindow, now: number): boolean {
  if (window.kind === "all") return true;
  if (window.kind === "rolling") return value > now - window.hours * 60 * 60 * 1000;
  if (window.kind === "toDate") return value >= startOfToDate(window, new Date(now));
  const start = Date.parse(`${window.startIso}T00:00:00Z`);
  const end = Date.parse(`${window.endIso}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  return value >= start && value < end;
}

function orderedCounts(counts: Map<string, number>) {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

/**
 * Estimate Channel contribution by fractionally assigning each registration to the Channel click
 * mix observed during the preceding 24 hours. This is aggregate attribution, not user tracking.
 */
export function campaignConversionAttribution(args: {
  snapshot: CampaignParticipantAnalyticsSnapshot;
  channels: CampaignChannel[];
  clicks: CampaignTrendClick[];
  window: AnalyticsWindow;
  now?: number;
}): CampaignConversionAttribution {
  const now = args.now ?? Date.now();
  const channelByLinkId = new Map<number | string, number>();
  const channelNames = new Map<number, string>();
  for (const channel of args.channels) {
    channelNames.set(channel.id, channel.name);
    for (const link of channel.links) channelByLinkId.set(link.id, channel.id);
  }

  const clicks = args.clicks.flatMap((row) => {
    const at = timestamp(row.hour);
    const channelId = channelByLinkId.get(row.linkId);
    return at === null || channelId === undefined || row.clicks <= 0
      ? []
      : [{ at, channelId, clicks: row.clicks }];
  });
  const clickTotals = new Map<number, number>();
  for (const click of clicks) {
    if (!isWithinWindow(click.at, args.window, now)) continue;
    clickTotals.set(click.channelId, (clickTotals.get(click.channelId) ?? 0) + click.clicks);
  }

  const registrations = args.snapshot.participants.flatMap((participant) => {
    const at = participant.registeredAt ? timestamp(participant.registeredAt) : null;
    return at !== null && isWithinWindow(at, args.window, now) ? [{ participant, at }] : [];
  });
  const estimates = new Map<number, number>();
  let attributedRegistrations = 0;
  for (const registration of registrations) {
    const nearby = new Map<number, number>();
    for (const click of clicks) {
      if (click.at > registration.at || click.at < registration.at - ATTRIBUTION_LOOKBACK_MS) {
        continue;
      }
      nearby.set(click.channelId, (nearby.get(click.channelId) ?? 0) + click.clicks);
    }
    const total = [...nearby.values()].reduce((sum, count) => sum + count, 0);
    if (total === 0) continue;
    attributedRegistrations += 1;
    for (const [channelId, count] of nearby) {
      estimates.set(channelId, (estimates.get(channelId) ?? 0) + count / total);
    }
  }

  const discovery = new Map<string, number>();
  for (const { participant } of registrations) {
    for (const channelId of participant.channelIds) {
      const name = channelNames.get(channelId);
      if (name) discovery.set(name, (discovery.get(name) ?? 0) + 1);
    }
  }
  const totalClicks = [...clickTotals.values()].reduce((sum, count) => sum + count, 0);
  const channels = [...new Set([...clickTotals.keys(), ...estimates.keys()])]
    .map((channelId) => {
      const channelClicks = clickTotals.get(channelId) ?? 0;
      const estimatedRegistrations = estimates.get(channelId) ?? 0;
      return {
        channelId,
        name: channelNames.get(channelId) ?? `Unknown channel (${channelId})`,
        clicks: channelClicks,
        estimatedRegistrations,
        contributionPercent:
          attributedRegistrations > 0
            ? (estimatedRegistrations / attributedRegistrations) * 100
            : 0,
        conversionRate: channelClicks > 0 ? (estimatedRegistrations / channelClicks) * 100 : 0,
      };
    })
    .sort(
      (left, right) =>
        right.estimatedRegistrations - left.estimatedRegistrations || right.clicks - left.clicks,
    );

  return {
    connpassEventId: args.snapshot.connpassEventId,
    updatedAt: new Date(args.snapshot.updatedAt * 1000).toISOString(),
    registrations: registrations.length,
    attributedRegistrations,
    attributionPercent:
      registrations.length > 0 ? (attributedRegistrations / registrations.length) * 100 : 0,
    conversionRate: totalClicks > 0 ? (attributedRegistrations / totalClicks) * 100 : 0,
    channels,
    discoveryChannels: orderedCounts(discovery),
  };
}
