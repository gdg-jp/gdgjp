import {
  Button,
  Card,
  Icons,
  Inline,
  Label,
  NativeSelect,
  Skeleton,
  Stack,
} from "@gdgjp/design-system";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { TopBlob, TopRow } from "~/features/analytics/analytics-engine";
import { serializeAnalyticsParams } from "~/features/analytics/analytics-filters";
import { AnalyticsAutomatedClicksToggle } from "~/features/analytics/components/analytics/analytics-automated-clicks-toggle";
import {
  AnalyticsBarListCard,
  AnalyticsBarListSkeleton,
  AnalyticsClicksChartCard,
  AnalyticsDimensionCards,
} from "~/features/analytics/components/analytics/analytics-breakdown-cards";
import { AnalyticsFiltersBar } from "~/features/analytics/components/analytics/analytics-filters-bar";
import { AnalyticsGraphInterval } from "~/features/analytics/components/analytics/analytics-graph-interval";
import {
  CampaignTrendChart,
  type TrendMetric,
} from "~/features/analytics/components/charts/campaign-trend-chart";
import type { CampaignTrendDimension } from "~/features/campaigns/campaign-analytics";
import { RegisterSourceDialog } from "~/features/campaigns/components/channel-dialogs";
import type { DetailChannel } from "~/features/campaigns/detail-types";
import type { CampaignsPageData } from "~/features/campaigns/detail.server";

export function CampaignPanelSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading campaign statistics">
      {["first", "second", "third"].slice(0, Math.max(1, Math.min(rows, 3))).map((key) => (
        <Skeleton key={key} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function CampaignAnalyticsSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading campaign analytics">
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-80 w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

export function CampaignAnalyticsPanel({
  analytics,
  channels,
  latestComments,
  selectedChannelId,
  selectedLinkId,
  shortUrlBase,
  preset,
  customStart,
  customEnd,
  filters,
  includeAutomated,
  bucket,
  scopeSearchParams,
  scopePending,
  analyticsPending,
}: {
  analytics: Awaited<CampaignsPageData["analytics"]>;
  channels: DetailChannel[];
  latestComments: CampaignsPageData["latestComments"];
  selectedChannelId: number | null;
  selectedLinkId: string | null;
  shortUrlBase: string;
  preset: CampaignsPageData["preset"];
  customStart: string | undefined;
  customEnd: string | undefined;
  filters: CampaignsPageData["filters"];
  includeAutomated: boolean;
  bucket: string;
  scopeSearchParams: URLSearchParams;
  scopePending: boolean;
  analyticsPending: boolean;
}) {
  const [, setSearchParams] = useSearchParams();
  const chartRef = useRef<HTMLDivElement>(null);
  const [breakdown, setBreakdown] = useState<CampaignTrendDimension>("total");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("clicks");
  const [graphFocus, setGraphFocus] = useState<{ key: string; label: string } | null>(null);
  const channelsInScope = selectedChannelId
    ? channels.filter((item) => item.id === selectedChannelId)
    : channels;
  const linkRows = channelsInScope
    .flatMap((item) => item.links)
    .filter((link) => !selectedLinkId || link.id === selectedLinkId)
    .map((link) => ({
      key: `link:${link.id}`,
      name: `${shortUrlBase}/${link.slug}`,
      description: latestComments[link.id],
      clicks: analytics.clicks[link.id] ?? 0,
    }))
    .sort((a, b) => b.clicks - a.clicks);
  const channelRows = channelsInScope
    .map((item) => ({
      key: `channel:${item.id}`,
      name: item.name,
      clicks: item.links.reduce((sum, link) => sum + (analytics.clicks[link.id] ?? 0), 0),
    }))
    .sort((a, b) => b.clicks - a.clicks);

  function selectGraphItem(
    dimension: Exclude<CampaignTrendDimension, "total">,
    row: { key?: string; name: string },
  ) {
    if (!row.key) return;
    setBreakdown(dimension);
    setTrendMetric("clicks");
    setGraphFocus({ key: row.key, label: row.name });
    requestAnimationFrame(() =>
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  }

  function changeBreakdown(value: CampaignTrendDimension) {
    setBreakdown(value);
    setGraphFocus(null);
    if (value === "total") setTrendMetric("clicks");
  }

  function applyDimensionFilter(dimension: Exclude<TopBlob, "slug" | "source">, row: TopRow) {
    if (row.name === "(unknown)") return;
    const next = serializeAnalyticsParams(scopeSearchParams, {
      filters: { ...filters, [dimension]: [row.name] },
    });
    setSearchParams(next, { preventScrollReset: true });
  }

  function setIncludeAutomated(checked: boolean) {
    setSearchParams(serializeAnalyticsParams(scopeSearchParams, { includeAutomated: checked }), {
      preventScrollReset: true,
    });
  }

  return (
    <div
      id="analytics-panel"
      role="tabpanel"
      aria-labelledby="analytics-tab"
      className="space-y-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-1 motion-safe:duration-200"
    >
      <section aria-labelledby="analytics-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Inline>
            <Icons name="ChartColumnIncreasing" aria-hidden="true" className="size-5" />
            <h2 id="analytics-heading" className="text-lg font-semibold">
              Analytics
            </h2>
          </Inline>
          <AnalyticsFiltersBar
            preset={preset}
            startIso={customStart}
            endIso={customEnd}
            filters={filters}
            suggestions={analytics.suggestions}
          />
        </div>
        <CampaignScopeFilters
          channels={channels}
          selectedChannelId={selectedChannelId}
          selectedLinkId={selectedLinkId}
          shortUrlBase={shortUrlBase}
          searchParams={scopeSearchParams}
          pending={scopePending}
        />
        <AnalyticsClicksChartCard
          ref={chartRef}
          total={analytics.total}
          pending={analyticsPending}
          footer={
            <AnalyticsAutomatedClicksToggle
              checked={includeAutomated}
              disabled={analyticsPending}
              onCheckedChange={setIncludeAutomated}
            />
          }
        >
          {analyticsPending ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <CampaignTrendChart
              rows={analytics.trend}
              channels={channelsInScope}
              height={260}
              granularity={analytics.granularity}
              bucketLabel={analytics.bucketLabel}
              intervalControl={<AnalyticsGraphInterval value={bucket} pending={analyticsPending} />}
              breakdown={breakdown}
              metric={trendMetric}
              focusKey={graphFocus?.key}
              focusLabel={graphFocus?.label}
              onBreakdownChange={changeBreakdown}
              onMetricChange={setTrendMetric}
              onClearFocus={() => setGraphFocus(null)}
            />
          )}
        </AnalyticsClicksChartCard>
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          <AnalyticsBarListCard
            title="Channel"
            description="Select a row to isolate its trend."
            rows={channelRows}
            loading={analyticsPending}
            loadingContent={<AnalyticsBarListSkeleton />}
            selectedKey={breakdown === "channel" ? graphFocus?.key : undefined}
            onSelect={(row) => selectGraphItem("channel", row)}
          />
          <AnalyticsBarListCard
            title="Sources"
            description="Select a row to isolate its trend."
            rows={analytics.topSources}
            emptyLabel="No source data yet."
            loading={analyticsPending}
            loadingContent={<AnalyticsBarListSkeleton />}
            selectedKey={breakdown === "source" ? graphFocus?.key : undefined}
            onSelect={(row) => selectGraphItem("source", row)}
          />
          <AnalyticsBarListCard
            title="Links"
            description="Select a row to isolate its trend."
            rows={linkRows}
            pending={scopePending}
            loading={analyticsPending}
            loadingContent={<AnalyticsBarListSkeleton />}
            selectedKey={breakdown === "link" ? graphFocus?.key : undefined}
            onSelect={(row) => selectGraphItem("link", row)}
          />
        </div>
        <AnalyticsDimensionCards
          analytics={analytics}
          pending={analyticsPending}
          selected={filters}
          onSelect={applyDimensionFilter}
        />
      </section>

      {analytics.unregisteredSources.length > 0 ? (
        <Card className="bg-warning/5">
          <Stack>
            <div className="space-y-2">
              <h2 className="text-sm">Unregistered sources detected</h2>
            </div>
            <div className="space-y-2">
              {analytics.unregisteredSources.map((source) => (
                <div
                  key={`${source.channelId}:${source.code}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
                >
                  <div>
                    <code className="text-sm">
                      {source.channelName} / {source.code}
                    </code>
                    <span className="ml-2 text-xs text-muted">{source.clicks} clicks</span>
                  </div>
                  {channels.find((item) => item.id === source.channelId)?.archivedAt === null ? (
                    <RegisterSourceDialog
                      code={source.code}
                      channelId={source.channelId}
                      channelName={source.channelName}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </Stack>
        </Card>
      ) : null}
    </div>
  );
}

export function CampaignScopeFilters({
  channels,
  selectedChannelId,
  selectedLinkId,
  shortUrlBase,
  searchParams,
  pending,
}: {
  channels: DetailChannel[];
  selectedChannelId: number | null;
  selectedLinkId: string | null;
  shortUrlBase: string;
  searchParams: URLSearchParams;
  pending: boolean;
}) {
  const [, setSearchParams] = useSearchParams();
  const links = (
    selectedChannelId ? channels.filter((item) => item.id === selectedChannelId) : channels
  ).flatMap((item) => item.links.map((link) => ({ ...link, channelName: item.name })));

  function setScope(name: "channelId" | "linkId", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "channelId") next.delete("linkId");
    setSearchParams(next, { preventScrollReset: true });
  }

  function clearScope() {
    const next = new URLSearchParams(searchParams);
    next.delete("channelId");
    next.delete("linkId");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div
      className="flex min-w-0 flex-col items-stretch gap-3 rounded-lg border bg-surface/20 p-3 sm:flex-row sm:flex-wrap sm:items-end"
      aria-busy={pending || undefined}
    >
      <div className="min-w-0 space-y-1 sm:min-w-48">
        <Label htmlFor="analytics-channels">Channel</Label>
        <NativeSelect
          id="analytics-channels"
          value={selectedChannelId ?? ""}
          onChange={(event) => setScope("channelId", event.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All channels</option>
          {channels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.archivedAt !== null ? " (Archived)" : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="min-w-0 flex-1 space-y-1 sm:min-w-56">
        <Label htmlFor="analytics-link">Link</Label>
        <NativeSelect
          id="analytics-link"
          value={selectedLinkId ?? ""}
          onChange={(event) => setScope("linkId", event.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All links</option>
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.channelName} / {shortUrlBase}/{link.slug}
            </option>
          ))}
        </NativeSelect>
      </div>
      {selectedChannelId || selectedLinkId ? (
        <Button type="button" variant="ghost" size="sm" onClick={clearScope}>
          <Icons name="X" aria-hidden="true" className="size-4" /> Clear scope
        </Button>
      ) : null}
    </div>
  );
}
