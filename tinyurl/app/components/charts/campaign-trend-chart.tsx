import type { ReactNode } from "react";
import { AnalyticsTrendChart, type TrendMetric } from "~/components/charts/analytics-trend-chart";
import type { CampaignTrendClick, Granularity } from "~/lib/analytics-engine";
import {
  type CampaignAnalyticsChannel,
  type CampaignTrendDimension,
  campaignTrendBreakdown,
} from "~/lib/campaign-analytics";

export type { TrendMetric } from "~/components/charts/analytics-trend-chart";

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
  return (
    <AnalyticsTrendChart
      points={points}
      series={series}
      granularity={granularity}
      bucketLabel={bucketLabel}
      intervalControl={intervalControl}
      breakdownOptions={BREAKDOWN_OPTIONS}
      breakdown={breakdown}
      metric={metric}
      focusKey={focusKey}
      focusLabel={focusLabel}
      onBreakdownChange={(value) => onBreakdownChange(value as CampaignTrendDimension)}
      onMetricChange={onMetricChange}
      onClearFocus={onClearFocus}
      height={height}
    />
  );
}
