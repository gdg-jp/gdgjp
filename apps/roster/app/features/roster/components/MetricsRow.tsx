import type { Metrics } from "~/features/solver/types";

export function MetricsRow({ metrics }: { metrics: Metrics }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const tiles = [
    {
      label: "未充足",
      value: `${metrics.minShortage + metrics.leadShortage}名`,
      detail: `頭数 ${metrics.minShortage} / 経験者 ${metrics.leadShortage}`,
    },
    {
      label: "理想充足率",
      value: pct(metrics.idealRate),
      detail: `${metrics.filled}/${metrics.demandIdeal}名`,
    },
    {
      label: "第1希望の役割",
      value: pct(metrics.firstChoiceRate),
      detail: `${metrics.assigned}枠中`,
    },
    {
      label: "負荷のばらつき",
      value: metrics.loadStdev.toFixed(1),
      detail: `最大 ${metrics.loadMax} / 最小 ${metrics.loadMin}枠`,
    },
    {
      label: "条件違反",
      value: `${metrics.violationCount}件`,
      detail: `△使用 ${metrics.softUsed}枠 / 連続超過 ${metrics.overwork}名`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs font-bold text-neutral-500">{tile.label}</p>
          <p className="text-xl font-bold">{tile.value}</p>
          <p className="text-[11px] text-neutral-500">{tile.detail}</p>
        </div>
      ))}
    </div>
  );
}
