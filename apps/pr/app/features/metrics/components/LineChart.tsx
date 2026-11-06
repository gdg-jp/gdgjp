type Point = { date: string; applications: number };

/** Applications against the goal curve: two lines, labelled, readable in light and dark. */
export function LineChart({ series, goal }: { series: Point[]; goal: Point[] }) {
  if (series.length === 0) return null;
  const width = 640;
  const height = 220;
  const pad = 32;
  const max = Math.max(1, ...series.map((p) => p.applications), ...goal.map((p) => p.applications));
  const x = (i: number) => pad + (i * (width - 2 * pad)) / Math.max(1, series.length - 1);
  const y = (v: number) => height - pad - (v * (height - 2 * pad)) / max;
  const path = (points: Point[]) =>
    points
      .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.applications).toFixed(1)}`)
      .join(" ");
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="申込の推移と目標"
        className="w-full text-fg"
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="currentColor"
          strokeOpacity={0.3}
        />
        <path
          d={path(goal)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeDasharray="6 4"
          strokeWidth={2}
        />
        <g className="text-primary">
          <path d={path(series)} fill="none" stroke="currentColor" strokeWidth={3} />
          {series.map((p, i) => (
            <circle key={p.date} cx={x(i)} cy={y(p.applications)} r={3} fill="currentColor">
              <title>{`${p.date}: ${p.applications}`}</title>
            </circle>
          ))}
        </g>
        <text x={pad} y={pad - 10} fontSize={12} fill="currentColor">
          {max}
        </text>
      </svg>
      <figcaption className="text-sm text-muted">実線: 申込 / 破線: 目標曲線</figcaption>
    </figure>
  );
}
