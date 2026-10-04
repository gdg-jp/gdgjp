import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Skeleton } from "~/components/ui/skeleton";
import type { BlobTrendPoint, TopBlob, TopRow } from "~/features/analytics/analytics-engine";
import {
  type DimensionFilters,
  serializeAnalyticsParams,
} from "~/features/analytics/analytics-filters";
import { AnalyticsAutomatedClicksToggle } from "~/features/analytics/components/analytics/analytics-automated-clicks-toggle";
import {
  AnalyticsBarListCard,
  AnalyticsBarListSkeleton,
  AnalyticsClicksChartCard,
  AnalyticsDimensionCards,
} from "~/features/analytics/components/analytics/analytics-breakdown-cards";
import { AnalyticsGraphInterval } from "~/features/analytics/components/analytics/analytics-graph-interval";
import { AnalyticsTrendChart } from "~/features/analytics/components/charts/analytics-trend-chart";
import type { AnalyticsData } from "~/features/analytics/page.server";

export type AnalyticsTrendDimension = "total" | "source" | "link";

export function trendFromRows(rows: BlobTrendPoint[], focusName?: string) {
  const totals = new Map<string, number>();
  const buckets = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (focusName && row.name !== focusName) continue;
    totals.set(row.name, (totals.get(row.name) ?? 0) + row.clicks);
    const bucket = buckets.get(row.hour) ?? new Map<string, number>();
    bucket.set(row.name, (bucket.get(row.name) ?? 0) + row.clicks);
    buckets.set(row.hour, bucket);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const keepCount = ranked.length > 6 ? 5 : ranked.length;
  const kept = ranked.slice(0, keepCount);
  const keptNames = new Set(kept.map(([name]) => name));
  const hasOther = ranked.length > kept.length;
  const series = kept.map(([name, clicks]) => ({ key: name, label: name, clicks }));
  if (hasOther) {
    series.push({
      key: "other",
      label: "Other",
      clicks: ranked.slice(keepCount).reduce((sum, [, clicks]) => sum + clicks, 0),
    });
  }
  const points = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hour, bucket]) => {
      const point: { hour: string; [key: string]: string | number } = { hour };
      for (const item of series) point[item.key] = 0;
      for (const [name, clicks] of bucket) {
        if (keptNames.has(name)) point[name] = clicks;
        else if (hasOther) point.other = Number(point.other ?? 0) + clicks;
      }
      return point;
    });
  return { points, series };
}

export function AnalyticsContent({
  data,
  filters,
  includeAutomated,
  bucket,
  pending,
}: {
  data: AnalyticsData;
  filters: DimensionFilters;
  includeAutomated: boolean;
  bucket: string;
  pending: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const chartRef = useRef<HTMLDivElement>(null);
  const [breakdown, setBreakdown] = useState<AnalyticsTrendDimension>("total");
  const [focus, setFocus] = useState<{ name: string; label: string } | null>(null);
  const trendRows = breakdown === "source" ? data.sourceTrend : data.linkTrend;
  const trend =
    breakdown === "total"
      ? {
          points: data.hourly.map(({ hour, clicks }) => ({ hour, total: clicks })),
          series: [{ key: "total", label: "Clicks", clicks: data.total }],
        }
      : trendFromRows(trendRows, focus?.name);

  function selectGraphItem(dimension: Exclude<AnalyticsTrendDimension, "total">, row: TopRow) {
    setBreakdown(dimension);
    setFocus({ name: row.name, label: row.name });
    requestAnimationFrame(() =>
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  }

  function isolateTrend(dimension: Exclude<TopBlob, "source" | "slug">, row: TopRow) {
    if (row.name === "(unknown)") return;
    const params = serializeAnalyticsParams(searchParams, {
      filters: { ...filters, [dimension]: [row.name] },
    });
    setSearchParams(params, { preventScrollReset: true });
  }

  function changeBreakdown(value: string) {
    setBreakdown(value as AnalyticsTrendDimension);
    setFocus(null);
  }

  function setIncludeAutomated(checked: boolean) {
    setSearchParams(serializeAnalyticsParams(searchParams, { includeAutomated: checked }), {
      preventScrollReset: true,
    });
  }

  return (
    <>
      <AnalyticsClicksChartCard
        ref={chartRef}
        total={data.total}
        pending={pending}
        footer={
          <AnalyticsAutomatedClicksToggle
            checked={includeAutomated}
            disabled={pending}
            onCheckedChange={setIncludeAutomated}
          />
        }
      >
        {pending ? (
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <AnalyticsTrendChart
            points={trend.points}
            series={trend.series}
            granularity={data.granularity}
            bucketLabel={data.bucketLabel}
            intervalControl={<AnalyticsGraphInterval value={bucket} pending={pending} />}
            breakdownOptions={[
              { value: "total", label: "Total" },
              { value: "source", label: "Sources" },
              { value: "link", label: "Links" },
            ]}
            breakdown={breakdown}
            focusKey={focus?.name}
            focusLabel={focus?.label}
            onBreakdownChange={changeBreakdown}
            onClearFocus={() => setFocus(null)}
          />
        )}
      </AnalyticsClicksChartCard>

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <AnalyticsBarListCard
          title="Sources"
          description="Select a row to isolate its trend."
          rows={data.sources}
          emptyLabel="No source data yet."
          loading={pending}
          loadingContent={<AnalyticsBarListSkeleton />}
          selectedKey={breakdown === "source" ? focus?.name : undefined}
          onSelect={(row) => selectGraphItem("source", row)}
        />
        <AnalyticsBarListCard
          title="Links"
          description="Select a row to isolate its trend."
          rows={data.slugs}
          emptyLabel="No clicks yet."
          loading={pending}
          loadingContent={<AnalyticsBarListSkeleton />}
          selectedKey={breakdown === "link" ? focus?.name : undefined}
          onSelect={(row) => selectGraphItem("link", row)}
        />
      </div>
      <AnalyticsDimensionCards
        analytics={data}
        pending={pending}
        selected={filters}
        onSelect={isolateTrend}
      />
    </>
  );
}

export function AnalyticsSkeleton() {
  const emptyDimensions = {
    referrers: [],
    countries: [],
    cities: [],
    regions: [],
    continents: [],
    devices: [],
    browsers: [],
    oses: [],
  };

  return (
    <>
      <AnalyticsClicksChartCard total={0} pending>
        <Skeleton className="h-[260px] w-full" />
      </AnalyticsClicksChartCard>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <AnalyticsBarListCard
          title="Sources"
          description="Select a row to isolate its trend."
          rows={[]}
          loading
          loadingContent={<AnalyticsBarListSkeleton />}
        />
        <AnalyticsBarListCard
          title="Links"
          description="Select a row to isolate its trend."
          rows={[]}
          loading
          loadingContent={<AnalyticsBarListSkeleton />}
        />
      </div>
      <AnalyticsDimensionCards analytics={emptyDimensions} loading />
    </>
  );
}
