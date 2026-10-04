import { useMemo } from "react";
import { GridLegend } from "~/features/roster/components/GridLegend";
import { groupAssignmentsByApplication } from "~/features/roster/grid";
import type { Assignments } from "~/features/solver/types";

export type PublicStaffGridSlot = { id: string; start: string; end: string };
export type PublicStaffGridColumn = { id: string; name: string };
type TrackInfo = { name: string; color: string };

/**
 * The public default view (docs/roster/09-share-public-views.md "Design"
 * §2a): vertical = time, horizontal = staff — visually the same shape as
 * Stage 07's owner-only `~/features/roster/components/StaffGrid`, but with
 * no experience-level column header (ADR-005), no availability violation
 * styling (public data has no `availability` at all — that field never
 * leaves `roster.server.ts`), and no click handler (read-only). Reuses
 * `roster/grid.ts#groupAssignmentsByApplication` for the per-application
 * per-slot lookup rather than re-deriving it — the same pure function
 * `StaffGrid` itself is built on top of (`buildStaffColumns`), and the same
 * `.data-grid*` layout classes, so the public page and the owner page are
 * the same table with less in it.
 */
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
  /** Application ids matching the name search — same contract as the
   * owner-side `StaffGrid`: the column header lights up, the cells keep
   * their track colour. */
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
                        style={track ? { backgroundColor: `${track.color}26` } : undefined}
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
