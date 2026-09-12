import { useId } from "react";
import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
function configColor(entry) {
  return entry?.color ?? entry?.theme?.light ?? "var(--gdg-primary)";
}
export function ChartContainer({ id, config, className, children, style, ...props }) {
  const generatedId = useId().replace(/:/g, "");
  const chartId = id ?? `chart-${generatedId}`;
  const colors = Object.entries(config ?? {}).reduce((result, [key, entry]) => {
    result[`--gdg-chart-${key}`] = configColor(entry);
    return result;
  }, {});
  return _jsx("div", {
    ...props,
    id: chartId,
    "data-chart": chartId,
    role: props.role ?? "img",
    style: { ...colors, ...style },
    className: cn("gdg-chart", className),
    children: children,
  });
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
  return _jsx(ChartContainer, {
    ...props,
    className: cn("gdg-chart-visual", className),
    config: { value: { color } },
    children: _jsxs("svg", {
      viewBox: `0 0 ${width} ${viewHeight}`,
      width: "100%",
      height: viewHeight,
      "aria-hidden": "true",
      focusable: "false",
      children: [
        _jsx("line", {
          x1: "0",
          x2: width,
          y1: height - 1,
          y2: height - 1,
          className: "gdg-chart-axis",
        }),
        type === "line"
          ? _jsxs(_Fragment, {
              children: [
                _jsx("polyline", {
                  points: points.map((point) => `${point.x},${point.y}`).join(" "),
                  className: "gdg-chart-line",
                }),
                points.map((point) =>
                  _jsx(
                    "circle",
                    { cx: point.x, cy: point.y, r: "4", className: "gdg-chart-point" },
                    `${point.label}-${point.x}`,
                  ),
                ),
              ],
            })
          : points.map((point) =>
              _jsx(
                "rect",
                {
                  x: point.x - step * 0.3,
                  y: point.y,
                  width: step * 0.6,
                  height: height - point.y - 1,
                  rx: "8",
                  className: "gdg-chart-bar",
                },
                `${point.label}-${point.x}`,
              ),
            ),
        points.map((point) =>
          _jsx(
            "text",
            {
              x: point.x,
              y: height + 18,
              textAnchor: "middle",
              className: "gdg-chart-label",
              children: point.label,
            },
            `label-${point.label}-${point.x}`,
          ),
        ),
      ],
    }),
  });
}
export function ChartTooltip({ className, ...props }) {
  return _jsx("div", { ...props, role: "tooltip", className: cn("gdg-chart-tooltip", className) });
}
export function ChartTooltipContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-chart-tooltip-content", className) });
}
export function ChartLegend({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-chart-legend", className) });
}
export function ChartLegendContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-chart-legend-content", className) });
}
