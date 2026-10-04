import { useMemo } from "react";
import type { Assignments, Demand } from "~/features/solver/types";
import { buildGridColumns, buildRoleGridColumn, gridColumnKey } from "../grid";
import { GridLegend } from "./GridLegend";

export type RoleGridSlot = { id: string; idx: number; start: string; end: string };
type TrackInfo = { id: string; name: string; color: string; sortOrder: number };
type RoleInfo = { id: string; name: string; sortOrder: number };

/**
 * The role-view on `/e/:id/roster`: vertical = time, horizontal =
 * (track × role) (docs/roster/07-roster-manual-edit.md "Design" §3b).
 * Reading a column answers "who is on reception at Track A from when to
 * when". Consecutive slots with the same lineup AND the same demand merge
 * into one spanning cell via `grid.ts#buildRoleGridColumn` — clicking a
 * merged cell selects the WHOLE range for `onSelectCell` (the caller opens
 * `DemandCellDrawer` and, on "add", places the chosen candidate into every
 * slot in the range at once — "一括で配置する", never one slot at a time).
 *
 * `readOnly` (docs/roster/09-share-public-views.md "Design" §2b) is Stage
 * 09's public role view reusing this exact component rather than forking it:
 * cells render as plain non-interactive containers (no `onSelectCell` call,
 * no hover affordance) and the per-cell `count/ideal` badge is hidden
 * outright, because the public caller has no real demand numbers to show —
 * it only knows "who is actually here", synthesized into a `demands`-shaped
 * map purely to reuse `buildGridColumns`/`buildRoleGridColumn`'s column
 * derivation and merge-by-membership logic (`app/routes/r.$token.tsx`).
 * Everything else (the merge algorithm, the member list, colors) is
 * identical between the two callers.
 *
 * Merged cells are the one place in the grid system that top-aligns
 * (`.data-grid-cell-top`): a lineup spanning four slots has to start at the
 * hour it starts at, not float in the middle of its own block.
 */
export function RoleGrid({
  timeSlots,
  tracks,
  roles,
  demands,
  assignments,
  nameById,
  onSelectCell,
  readOnly = false,
  matchedIds,
}: {
  timeSlots: readonly RoleGridSlot[];
  tracks: readonly TrackInfo[];
  roles: readonly RoleInfo[];
  demands: ReadonlyMap<string, Demand>;
  assignments: Assignments;
  nameById: ReadonlyMap<string, string>;
  onSelectCell?: (trackId: string, roleId: string, slotIds: string[]) => void;
  readOnly?: boolean;
  /** Application ids matching the name search (`GridSearch`) — every
   * occurrence of the name in a cell's lineup is marked, since the whole
   * point of this view is "where is this person, and when". */
  matchedIds?: ReadonlySet<string>;
}) {
  const columns = useMemo(() => buildGridColumns(demands, tracks, roles), [demands, tracks, roles]);
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const columnCells = useMemo(
    () =>
      new Map(
        columns.map((col) => [
          gridColumnKey(col.trackId, col.roleId),
          buildRoleGridColumn(timeSlots, col.trackId, col.roleId, assignments, demands),
        ]),
      ),
    [columns, timeSlots, assignments, demands],
  );

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted">
        {readOnly ? "誰も割り当てられていません。" : "需要が設定されていません。"}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <GridLegend tracks={tracks} />
      <div className="data-grid-wrap">
        <table className="data-grid">
          <thead>
            <tr>
              <th scope="col" className="data-grid-rowhead">
                時間
              </th>
              {columns.map((col) => (
                <th
                  key={gridColumnKey(col.trackId, col.roleId)}
                  scope="col"
                  className="data-grid-colhead"
                >
                  {roleById.get(col.roleId)?.name ?? col.roleId}
                  <span className="sub">{trackById.get(col.trackId)?.name ?? col.trackId}</span>
                </th>
              ))}
              <th className="data-grid-filler" />
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot, rowIdx) => (
              <tr key={slot.id}>
                <th scope="row" className="data-grid-rowhead">
                  {slot.start}–{slot.end}
                </th>
                {columns.map((col) => {
                  const colKey = gridColumnKey(col.trackId, col.roleId);
                  const cell = columnCells.get(colKey)?.[rowIdx];
                  if (!cell || cell.kind === "continued") return null;
                  const rangeSlotIds = timeSlots.slice(rowIdx, rowIdx + cell.span).map((s) => s.id);
                  const label =
                    cell.span > 1
                      ? `${slot.start}–${timeSlots[rowIdx + cell.span - 1].end}`
                      : `${slot.start}–${slot.end}`;
                  const track = trackById.get(col.trackId);
                  const ariaLabel = `${label} / ${track?.name ?? col.trackId} / ${
                    roleById.get(col.roleId)?.name ?? col.roleId
                  }`;
                  const empty = cell.memberIds.length === 0;
                  const className = `data-grid-cell data-grid-cell-top${
                    empty ? " data-grid-cell-empty" : ""
                  }`;
                  const style =
                    track && !empty ? { backgroundColor: `${track.color}26` } : undefined;
                  // "需要なし" is a fact about the CELL, so it belongs on the
                  // count line and has to survive even when people are
                  // assigned there — a manual edit can place staff into a
                  // zero-demand slot, and this view is where that shows up.
                  // Only the redundant "空き" underneath it is suppressed.
                  const body = (
                    <>
                      {readOnly ? null : (
                        <span className="note">
                          {cell.demand
                            ? `${cell.memberIds.length}/${cell.demand.ideal}`
                            : "需要なし"}
                        </span>
                      )}
                      {empty && (readOnly || cell.demand) ? <span>空き</span> : null}
                      {empty
                        ? null
                        : cell.memberIds.map((id) => {
                            const hit = matchedIds?.has(id) ?? false;
                            return (
                              <span
                                key={id}
                                className={hit ? "grid-match" : undefined}
                                data-search-match={hit ? "true" : undefined}
                              >
                                {nameById.get(id) ?? id}
                              </span>
                            );
                          })}
                    </>
                  );
                  return (
                    // No `align-top` here: app.css's unlayered
                    // `.data-grid td { vertical-align: middle }` outranks the
                    // utilities layer, so it would be dead. `.data-grid-cell-top`
                    // on the cell itself is what actually top-aligns a merged
                    // range's lineup.
                    <td key={colKey} rowSpan={cell.span}>
                      {readOnly ? (
                        <div aria-label={ariaLabel} className={className} style={style}>
                          {body}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectCell?.(col.trackId, col.roleId, rangeSlotIds)}
                          aria-label={ariaLabel}
                          className={className}
                          style={style}
                        >
                          {body}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="data-grid-filler" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
