import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Granularity, HourlyPoint } from "~/lib/analytics-engine";

function formatTick(value: string, granularity: Granularity): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (granularity === "hour") {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function HourlyChart({
  data,
  height = 320,
  granularity = "hour",
}: {
  data: HourlyPoint[];
  height?: number;
  granularity?: Granularity;
}) {
  const fmt = (v: string) => formatTick(v, granularity);
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
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id="hourly-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-gdg-blue)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-gdg-blue)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="hour"
          tickFormatter={fmt}
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          stroke="var(--color-border)"
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          stroke="var(--color-border)"
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip
          labelFormatter={fmt}
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="clicks"
          stroke="var(--color-gdg-blue)"
          strokeWidth={2}
          fill="url(#hourly-fill)"
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
