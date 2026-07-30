import type {
  AnalyticsTrendPoint,
  AnalyticsTrendSeries,
} from "~/components/charts/analytics-trend-chart";
import {
  type Granularity,
  type TimeBucket,
  granularityFor,
  granularityForTimeBucket,
  timeBucketLabel,
} from "~/lib/analytics-engine";
import type { AnalyticsWindow } from "~/lib/analytics-filters";
import type { CampaignParticipantAnalyticsSnapshot } from "~/lib/campaign-participant-analytics-db";

const UNANSWERED = "Unanswered";

type CampaignChannel = { id: number; name: string };

export type CampaignAcquisitionAnalytics = {
  summary: {
    applications: number;
    cancellations: number;
    attendanceRate: number | null;
    participationTypes: Array<{ name: string; count: number }>;
  };
  channels: Array<{ key: string; name: string; count: number }>;
  points: AnalyticsTrendPoint[];
  series: AnalyticsTrendSeries[];
  granularity: Granularity;
  bucketLabel: string;
};

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function withinWindow(value: number, window: AnalyticsWindow, now: number): boolean {
  if (window.kind === "all") return true;
  if (window.kind === "rolling") return value > now - window.hours * 60 * 60 * 1000;
  if (window.kind === "toDate") {
    const date = new Date(now);
    const start =
      window.unit === "year"
        ? Date.UTC(date.getUTCFullYear(), 0, 1)
        : window.unit === "quarter"
          ? Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1)
          : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return value >= start;
  }
  const start = Date.parse(`${window.startIso}T00:00:00Z`);
  const end = Date.parse(`${window.endIso}T00:00:00Z`) + 86_400_000;
  return value >= start && value < end;
}

function bucketAt(value: number, bucket: TimeBucket): string {
  const unitMs = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
  }[bucket.unit];
  // Weeks are Monday-aligned, matching Analytics Engine's toStartOfWeek default.
  const origin = bucket.unit === "week" ? Date.UTC(1970, 0, 5) : 0;
  const size = unitMs * bucket.amount;
  return new Date(Math.floor((value - origin) / size) * size + origin).toISOString();
}

function cancelled(status: string): boolean {
  return /キャンセル|取消|辞退/.test(status);
}

function attended(status: string): boolean {
  return /出席/.test(status);
}

export function campaignAcquisitionAnalytics(args: {
  snapshot: CampaignParticipantAnalyticsSnapshot;
  channels: CampaignChannel[];
  window: AnalyticsWindow;
  bucket?: TimeBucket;
  now?: number;
}): CampaignAcquisitionAnalytics {
  const now = args.now ?? Date.now();
  const bucket = args.bucket ?? { amount: 1, unit: granularityFor(args.window) };
  const granularity = args.bucket
    ? granularityForTimeBucket(args.bucket)
    : granularityFor(args.window);
  const names = new Map(args.channels.map((channel) => [channel.id, channel.name]));
  const counts = new Map<string, number>();
  const buckets = new Map<string, Map<string, number>>();
  let applications = 0;
  let cancellations = 0;
  let activeApplications = 0;
  let attendees = 0;
  const participationTypes = new Map<string, number>();

  for (const participant of args.snapshot.participants) {
    const registeredAt = timestamp(participant.registeredAt ?? participant.lastUpdatedAt);
    if (registeredAt === null || !withinWindow(registeredAt, args.window, now)) continue;
    applications += 1;
    participationTypes.set(
      participant.participationType,
      (participationTypes.get(participant.participationType) ?? 0) + 1,
    );
    if (cancelled(participant.participationStatus)) {
      cancellations += 1;
      continue;
    }
    activeApplications += 1;
    if (attended(participant.attendanceStatus)) attendees += 1;
    const channelNames = participant.channelIds
      .map((channelId) => names.get(channelId))
      .filter((name): name is string => Boolean(name));
    const acquisitions = channelNames.length > 0 ? [...new Set(channelNames)] : [UNANSWERED];
    const bucketKey = bucketAt(registeredAt, bucket);
    const bucketCounts = buckets.get(bucketKey) ?? new Map<string, number>();
    for (const name of acquisitions) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      bucketCounts.set(name, (bucketCounts.get(name) ?? 0) + 1);
    }
    buckets.set(bucketKey, bucketCounts);
  }

  const ranked = [...counts.entries()].sort(
    ([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
  );
  const keepCount = ranked.length > 6 ? 5 : ranked.length;
  const kept = ranked.slice(0, keepCount);
  const keptNames = new Set(kept.map(([name]) => name));
  const hasOther = ranked.length > kept.length;
  const series: AnalyticsTrendSeries[] = kept.map(([name, count]) => ({
    key: `channel:${name}`,
    label: name,
    clicks: count,
  }));
  if (hasOther) {
    series.push({
      key: "other",
      label: "Other",
      clicks: ranked.slice(keepCount).reduce((total, [, count]) => total + count, 0),
    });
  }

  const points = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hour, bucket]) => {
      const point: AnalyticsTrendPoint = { hour };
      for (const item of series) point[item.key] = 0;
      for (const [name, count] of bucket) {
        const key = keptNames.has(name) ? `channel:${name}` : "other";
        point[key] = Number(point[key] ?? 0) + count;
      }
      return point;
    });

  return {
    summary: {
      applications,
      cancellations,
      attendanceRate: activeApplications > 0 ? (attendees / activeApplications) * 100 : null,
      participationTypes: [...participationTypes.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    },
    channels: ranked.map(([name, count]) => ({ key: `channel:${name}`, name, count })),
    points,
    series,
    granularity,
    bucketLabel: timeBucketLabel(bucket),
  };
}
