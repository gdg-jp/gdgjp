import type { MatrixCell } from "../matrix";

// A `newMax` at (or above) the schema default effectively means "no cap" —
// the badge would fire on every single cell otherwise, since the column
// default is 99 (docs/roster/index.md §4 demands schema).
const NEW_MAX_DEFAULT = 99;

/**
 * One cell of the demand matrix on `/e/:id/design`
 * (docs/roster/03-demand-input.md "Design" §4). A button (not a link) so it
 * behaves inside the surrounding `<table>` and stays keyboard-reachable;
 * clicking it opens `DemandDrawer` for this (row, track, role).
 *
 * Uses the shared `.data-grid-cell` so it fills its `<td>` edge to edge —
 * the matrix is a grid, not a field of floating chips, and a set demand has
 * to read as one filled block against the empty ones around it. The fill is
 * `.data-grid-cell-set` rather than a Tailwind `bg-*` utility: `app.css`'s
 * unlayered `.data-grid-cell { background: none }` outranks the utilities
 * layer, so a `bg-*` here would silently render transparent.
 */
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
