import { AnalyticsAreaChart } from "~/components/charts/analytics-area-chart";
import type { Granularity, HourlyPoint } from "~/lib/analytics-engine";

export function HourlyChart({
  data,
  height = 320,
  granularity = "hour",
}: {
  data: HourlyPoint[];
  height?: number;
  granularity?: Granularity;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        No clicks in this range yet.
      </div>
    );
  }
  return (
    <AnalyticsAreaChart
      data={data}
      granularity={granularity}
      height={height}
      definitions={
        <linearGradient id="hourly-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-gdg-blue)" stopOpacity={0.25} />
          <stop offset="100%" stopColor="var(--color-gdg-blue)" stopOpacity={0} />
        </linearGradient>
      }
      series={[{ key: "clicks", color: "var(--color-gdg-blue)", fill: "url(#hourly-fill)" }]}
    />
  );
}
