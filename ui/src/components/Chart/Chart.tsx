import type { CSSProperties, ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { cn } from "../../utils";

export type ChartConfig = Record<
  string,
  {
    label?: ReactNode;
    color?: string;
    theme?: { light?: string; dark?: string };
  }
>;

export type ChartDatum = Record<string, string | number>;

function configColor(entry: ChartConfig[string] | undefined) {
  return entry?.color ?? entry?.theme?.light ?? "var(--gdg-primary)";
}

export function ChartContainer({
  id,
  config,
  className,
  children,
  style,
  ...props
}: ComponentProps<"div"> & { config?: ChartConfig; id?: string }) {
  const generatedId = useId().replace(/:/g, "");
  const chartId = id ?? `chart-${generatedId}`;
  const colors = Object.entries(config ?? {}).reduce<Record<string, string>>(
    (result, [key, entry]) => {
      result[`--gdg-chart-${key}`] = configColor(entry);
      return result;
    },
    {},
  );
  return (
    <div
      {...props}
      id={chartId}
      data-chart={chartId}
      role={props.role ?? "img"}
      style={{ ...colors, ...style } as CSSProperties}
      className={cn("gdg-chart", className)}
    >
      {children}
    </div>
  );
}

export function Chart({
  data,
  valueKey = "value",
  labelKey = "label",
  type = "bar",
  color = "var(--gdg-primary)",
  height = 220,
  className,
  ...props
}: ComponentProps<"div"> & {
  data: ChartDatum[];
  valueKey?: string;
  labelKey?: string;
  type?: "bar" | "line";
  color?: string;
  height?: number;
}) {
  const values = data.map((item) => Number(item[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  const width = Math.max(data.length * 56, 280);
  const viewHeight = height + 28;
  const step = width / Math.max(data.length, 1);
  const points = data.map((item, index) => {
    const value = values[index] ?? 0;
    return {
      x: step * index + step / 2,
      y: height - (value / max) * (height - 28),
      value,
      label: String(item[labelKey] ?? ""),
    };
  });
  return (
    <ChartContainer
      {...props}
      className={cn("gdg-chart-visual", className)}
      config={{ value: { color } }}
    >
      <svg
        viewBox={`0 0 ${width} ${viewHeight}`}
        width="100%"
        height={viewHeight}
        aria-hidden="true"
        focusable="false"
      >
        <line x1="0" x2={width} y1={height - 1} y2={height - 1} className="gdg-chart-axis" />
        {type === "line" ? (
          <>
            <polyline
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              className="gdg-chart-line"
            />
            {points.map((point) => (
              <circle
                key={`${point.label}-${point.x}`}
                cx={point.x}
                cy={point.y}
                r="4"
                className="gdg-chart-point"
              />
            ))}
          </>
        ) : (
          points.map((point) => (
            <rect
              key={`${point.label}-${point.x}`}
              x={point.x - step * 0.3}
              y={point.y}
              width={step * 0.6}
              height={height - point.y - 1}
              rx="8"
              className="gdg-chart-bar"
            />
          ))
        )}
        {points.map((point) => (
          <text
            key={`label-${point.label}-${point.x}`}
            x={point.x}
            y={height + 18}
            textAnchor="middle"
            className="gdg-chart-label"
          >
            {point.label}
          </text>
        ))}
      </svg>
    </ChartContainer>
  );
}

export function ChartTooltip({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} role="tooltip" className={cn("gdg-chart-tooltip", className)} />;
}

export function ChartTooltipContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-chart-tooltip-content", className)} />;
}

export function ChartLegend({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-chart-legend", className)} />;
}

export function ChartLegendContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-chart-legend-content", className)} />;
}
