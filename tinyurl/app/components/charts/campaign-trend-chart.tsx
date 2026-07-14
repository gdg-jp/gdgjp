import { X } from "lucide-react";
import type { ReactNode } from "react";
import { AnalyticsAreaChart, formatAnalyticsTick } from "~/components/charts/analytics-area-chart";
import { Button } from "~/components/ui/button";
import type { CampaignTrendClick, Granularity } from "~/lib/analytics-engine";
import {
  type CampaignAnalyticsChannel,
  type CampaignTrendDimension,
  campaignTrendBreakdown,
} from "~/lib/campaign-analytics";
import { cn } from "~/lib/utils";

export type TrendMetric = "clicks" | "share";

const COLORS = ["#4285f4", "#ea4335", "#f9ab00", "#34a853", "#a855f7", "#06b6d4"];

const BREAKDOWN_OPTIONS: Array<{ value: CampaignTrendDimension; label: string }> = [
  { value: "total", label: "Total" },
  { value: "channel", label: "Channel" },
  { value: "source", label: "Source" },
  { value: "link", label: "Links" },
];

export function CampaignTrendChart({
  rows,
  channels,
  granularity,
  bucketLabel,
  intervalControl,
  breakdown,
  metric,
  focusKey,
  focusLabel,
  onBreakdownChange,
  onMetricChange,
  onClearFocus,
  height = 260,
}: {
  rows: CampaignTrendClick[];
  channels: CampaignAnalyticsChannel[];
  granularity: Granularity;
  bucketLabel: string;
  intervalControl?: ReactNode;
  breakdown: CampaignTrendDimension;
  metric: TrendMetric;
  focusKey?: string;
  focusLabel?: string;
  onBreakdownChange: (value: CampaignTrendDimension) => void;
  onMetricChange: (value: TrendMetric) => void;
  onClearFocus: () => void;
  height?: number;
}) {
  const { points, series } = campaignTrendBreakdown(channels, rows, breakdown, focusKey);
  const displayPoints =
    metric === "share"
      ? points.map((point) => {
          const total = series.reduce((sum, item) => sum + Number(point[item.key] ?? 0), 0);
          const display = { ...point };
          for (const item of series) {
            display[item.key] = total > 0 ? (Number(point[item.key] ?? 0) / total) * 100 : 0;
          }
          return display;
        })
      : points;
  const displayedTotal = series.reduce((sum, item) => sum + item.clicks, 0);
  const peak = points.reduce<{ hour: string; clicks: number }>(
    (best, point) => {
      const clicks = series.reduce((sum, item) => sum + Number(point[item.key] ?? 0), 0);
      return clicks > best.clicks ? { hour: String(point.hour), clicks } : best;
    },
    { hour: "", clicks: 0 },
  );
  const formatter = (value: string) => formatAnalyticsTick(value, granularity);
  const chartSeries = series.map((item, index) => ({
    key: item.key,
    label: item.label,
    color: COLORS[index % COLORS.length],
    fillOpacity: series.length > 1 ? 0.18 : 0.12,
  }));

  return (
    <div className="space-y-3">
      {displayPoints.length === 0 ? (
        <div
          className="flex items-center justify-center text-sm text-muted-foreground"
          style={{ height }}
        >
          No clicks in this range yet.
        </div>
      ) : (
        <>
          <AnalyticsAreaChart
            data={displayPoints}
            granularity={granularity}
            height={height}
            series={chartSeries}
            percentage={metric === "share"}
            stackSeries={metric === "share" && series.length > 1}
            formatValue={(value) =>
              metric === "share" ? `${value.toFixed(1)}%` : value.toLocaleString()
            }
          />
          {series.length > 1 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
              {series.map((item, index) => (
                <li key={item.key} className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    aria-hidden
                  />
                  <span className="max-w-40 truncate" title={item.label}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-xs text-muted-foreground">
            <span>
              Displayed{" "}
              <strong className="font-medium text-foreground">
                {displayedTotal.toLocaleString()}
              </strong>
            </span>
            <span>
              Avg / active {bucketLabel}{" "}
              <strong className="font-medium text-foreground">
                {(displayedTotal / Math.max(points.length, 1)).toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
              </strong>
            </span>
            {peak.hour ? (
              <span title={new Date(peak.hour).toLocaleString()}>
                Peak{" "}
                <strong className="font-medium text-foreground">
                  {peak.clicks.toLocaleString()}
                </strong>{" "}
                · {formatter(peak.hour)}
              </span>
            ) : null}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Break down by</span>
          <div className="flex rounded-md border bg-muted/30 p-0.5" aria-label="Chart breakdown">
            {BREAKDOWN_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={breakdown === option.value}
                onClick={() => onBreakdownChange(option.value)}
                className={cn(
                  "rounded-sm px-2.5 text-muted-foreground",
                  breakdown === option.value &&
                    "bg-background text-foreground shadow-xs hover:bg-background",
                )}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {intervalControl}
        </div>
        <div className="flex items-center gap-2">
          {breakdown !== "total" && !focusKey ? (
            <div className="flex rounded-md border bg-muted/30 p-0.5" aria-label="Chart metric">
              {(["clicks", "share"] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-pressed={metric === value}
                  onClick={() => onMetricChange(value)}
                  className={cn(
                    "rounded-sm px-2.5 capitalize text-muted-foreground",
                    metric === value &&
                      "bg-background text-foreground shadow-xs hover:bg-background",
                  )}
                >
                  {value}
                </Button>
              ))}
            </div>
          ) : null}
          {focusKey ? (
            <Button type="button" variant="secondary" size="xs" onClick={onClearFocus}>
              <span className="max-w-44 truncate">Only: {focusLabel}</span>
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
