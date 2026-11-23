import { useMemo } from "react";
import { GridLegend } from "~/features/roster/components/GridLegend";
import { groupAssignmentsByApplication } from "~/features/roster/grid";
import type { Assignments } from "~/features/solver/types";

export type PublicStaffGridSlot = { id: string; start: string; end: string };
export type PublicStaffGridColumn = { id: string; name: string };
type TrackInfo = { name: string; color: string };

export function PublicStaffGrid({
  timeSlots,
  columns,
  assignments,
  trackById,
  roleNameById,
  matchedIds,
}: {
  timeSlots: readonly PublicStaffGridSlot[];
  columns: readonly PublicStaffGridColumn[];
  assignments: Assignments;
  trackById: ReadonlyMap<string, TrackInfo>;
  roleNameById: ReadonlyMap<string, string>;
  matchedIds?: ReadonlySet<string>;
}) {
  const byApp = useMemo(() => groupAssignmentsByApplication(assignments), [assignments]);

  if (columns.length === 0) {
    return <p className="text-sm text-muted">表示できるスタッフがいません。</p>;
  }

  return (
    <div className="space-y-2">
      <GridLegend tracks={[...trackById.values()]} />
      <div className="data-grid-wrap">
        <table className="data-grid">
          <thead>
            <tr>
              <th scope="col" className="data-grid-rowhead">
                時間
              </th>
              {columns.map((col) => {
                const matched = matchedIds?.has(col.id) ?? false;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={`data-grid-colhead${matched ? " data-grid-colhead-match" : ""}`}
                    data-search-match={matched ? "true" : undefined}
                  >
                    {matched ? <span className="grid-match">{col.name}</span> : col.name}
                  </th>
                );
              })}
              <th className="data-grid-filler" />
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot) => (
              <tr key={slot.id}>
                <th scope="row" className="data-grid-rowhead">
                  {slot.start}–{slot.end}
                </th>
                {columns.map((col) => {
                  const value = byApp.get(col.id)?.get(slot.id);
                  const track = value ? trackById.get(value.trackId) : undefined;
                  const roleName = value ? (roleNameById.get(value.roleId) ?? value.roleId) : "";
                  return (
                    <td key={col.id}>
                      <div
                        aria-label={`${col.name} / ${slot.start}–${slot.end}${
                          track ? `：${track.name} ${roleName}` : "：空き"
                        }`}
                        className={`data-grid-cell${value ? "" : " data-grid-cell-empty"}`}
                      >
                        {value ? (
                          <>
                            <span className="role">{roleName}</span>
                            <span className="track">{track?.name ?? value.trackId}</span>
                          </>
                        ) : (
                          <span aria-hidden="true">—</span>
                        )}
                      </div>
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
