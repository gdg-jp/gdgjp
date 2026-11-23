import type { MatrixCell } from "../matrix";

const NEW_MAX_DEFAULT = 99;

export function DemandCell({
  cell,
  label,
  onClick,
}: {
  cell: MatrixCell;
  label: string;
  onClick: () => void;
}) {
  if (cell.kind === "empty") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}：需要なし。クリックして追加`}
        className="data-grid-cell data-grid-cell-empty"
      >
        <span aria-hidden="true">–</span>
      </button>
    );
  }

  const { min, ideal, leadMin, newMax } = cell.value;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}：最小${min}、理想${ideal}${cell.uniform ? "" : "（時間枠ごとに異なる）"}`}
      className="data-grid-cell data-grid-cell-set"
    >
      <span className="font-bold tabular-nums">
        {min}/{ideal}
        {cell.uniform ? "" : "*"}
      </span>
      {(leadMin > 0 || newMax < NEW_MAX_DEFAULT) && (
        <span className="flex flex-wrap justify-center gap-1">
          {leadMin > 0 ? (
            <span className="rounded-sm bg-gdg-blue/20 px-1 text-xs font-bold text-gdg-blue">
              L≥{leadMin}
            </span>
          ) : null}
          {newMax < NEW_MAX_DEFAULT ? (
            <span className="rounded-sm bg-gdg-blue/10 px-1 text-xs font-bold text-foreground">
              新≤{newMax}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}
