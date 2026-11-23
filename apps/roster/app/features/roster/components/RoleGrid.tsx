import { useMemo } from "react";
import type { Assignments, Demand } from "~/features/solver/types";
import { buildGridColumns, buildRoleGridColumn, gridColumnKey } from "../grid";
import { GridLegend } from "./GridLegend";

export type RoleGridSlot = { id: string; idx: number; start: string; end: string };
type TrackInfo = { id: string; name: string; color: string; sortOrder: number };
type RoleInfo = { id: string; name: string; sortOrder: number };

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
                    <td key={colKey} rowSpan={cell.span}>
                      {readOnly ? (
                        <div aria-label={ariaLabel} className={className}>
                          {body}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectCell?.(col.trackId, col.roleId, rangeSlotIds)}
                          aria-label={ariaLabel}
                          className={className}
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
