import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Granularity } from "~/lib/analytics-engine";

export type AnalyticsAreaSeries = {
  key: string;
  label?: string;
  color: string;
  fill?: string;
  fillOpacity?: number;
};

export function formatAnalyticsTick(value: string, granularity: Granularity): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (granularity === "hour") {
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AnalyticsAreaChart({
  data,
  xKey = "hour",
  granularity,
  series,
  height,
  definitions,
  percentage = false,
  stackSeries = false,
  formatValue,
}: {
  data: readonly object[];
  xKey?: string;
  granularity: Granularity;
  series: AnalyticsAreaSeries[];
  height: number;
  definitions?: ReactNode;
  percentage?: boolean;
  stackSeries?: boolean;
  formatValue?: (value: number, series: AnalyticsAreaSeries) => string;
}) {
  const formatter = (value: string) => formatAnalyticsTick(value, granularity);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={[...data]} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        {definitions ? <defs>{definitions}</defs> : null}
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={formatter}
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          stroke="var(--color-border)"
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          allowDecimals={percentage}
          domain={percentage ? [0, 100] : undefined}
          tickFormatter={percentage ? (value) => `${value}%` : undefined}
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          stroke="var(--color-border)"
          axisLine={false}
          tickLine={false}
          width={percentage ? 42 : 32}
        />
        <Tooltip
          labelFormatter={formatter}
          formatter={
            formatValue
              ? (value, name) => {
                  const item = series.find((candidate) => candidate.key === String(name));
                  return [
                    formatValue(Number(value ?? 0), item ?? series[0]),
                    item?.label ?? String(name),
                  ];
                }
              : undefined
          }
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            fontSize: 12,
          }}
        />
        {series.map((item) => (
          <Area
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.key}
            stackId={stackSeries ? "campaign" : undefined}
            stroke={item.color}
            strokeWidth={2}
            fill={item.fill ?? item.color}
            fillOpacity={item.fillOpacity}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
