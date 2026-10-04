import { useMemo } from "react";
import { LEVEL_LABELS, type Level } from "~/features/applications/types";
import type { Assignments } from "~/features/solver/types";
import { assignmentKey } from "~/features/solver/types";
import type { StaffGridColumn } from "../grid";
import { GridLegend } from "./GridLegend";

export type { StaffGridColumn } from "../grid";
export type StaffGridSlot = { id: string; start: string; end: string };

type TrackInfo = { name: string; color: string };

/**
 * The default view on `/e/:id/roster`: vertical = time, horizontal = staff
 * (docs/roster/07-roster-manual-edit.md "Design" §3a). One column per staff
 * member's whole day; reading across a row answers "who is where right now".
 *
 * A cell shows the role name and the track name (never the experience
 * level — that's the column header's job, ADR-005 in spirit even though
 * this is the owner-only screen) with the track's color as a background
 * tint so a same-track run reads as a solid stripe down the column.
 *
 * Layout comes entirely from the shared `.data-grid*` classes in `app.css`
 * (see that file's "2 次元表" block) rather than per-component Tailwind: the
 * time column, the sticky header, and the cell fill have to be identical
 * across all four grids or the views stop reading side-by-side.
 */
export function StaffGrid({
  timeSlots,
  columns,
  assignments,
  trackById,
  roleNameById,
  onCellClick,
  matchedIds,
}: {
  timeSlots: readonly StaffGridSlot[];
  columns: readonly StaffGridColumn[];
  assignments: Assignments;
  trackById: ReadonlyMap<string, TrackInfo>;
  roleNameById: ReadonlyMap<string, string>;
  onCellClick: (applicationId: string, slotId: string) => void;
  /** Application ids matching the name search (`GridSearch`). Their column
   * header lights up; the cells keep their track colour so the vertical
   * stripe stays readable. */
  matchedIds?: ReadonlySet<string>;
}) {
  const byAppSlot = useMemo(() => {
    const map = new Map<string, { trackId: string; roleId: string }>();
    for (const [key, value] of assignments) {
      map.set(key, { trackId: value.trackId, roleId: value.roleId });
    }
    return map;
  }, [assignments]);

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted">
        表示できるスタッフがいません。募集期間中に登録があるか確認してください。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <GridLegend tracks={[...trackById.values()]} showAvailabilityStates />
      <div className="data-grid-wrap">
        <table className="data-grid">
          <thead>
            <tr>
              <th scope="col" className="data-grid-rowhead">
                時間
              </th>
              {columns.map((col) => {
                // Every match is marked; `GridSearch`'s `querySelector` takes
                // the first in DOM order, which here is the leftmost hit.
                const matched = matchedIds?.has(col.applicationId) ?? false;
                return (
                  <th
                    key={col.applicationId}
                    scope="col"
                    className={`data-grid-colhead${matched ? " data-grid-colhead-match" : ""}`}
                    data-search-match={matched ? "true" : undefined}
                  >
                    <span className={col.withdrawn ? "text-gdg-red line-through" : undefined}>
                      {matched ? <span className="grid-match">{col.name}</span> : col.name}
                      {col.withdrawn ? "（辞退）" : ""}
                    </span>
                    {col.skills.length > 0 ? (
                      <span className="sub" title={skillsTitle(col.skills)}>
                        {col.skills[0].roleName}:{LEVEL_LABELS[col.skills[0].level]}
                        {col.skills.length > 1 ? ` +${col.skills.length - 1}` : ""}
                      </span>
                    ) : null}
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
                  const value = byAppSlot.get(assignmentKey(col.applicationId, slot.id));
                  const availability = col.availability[slot.id] ?? "x";
                  const softUsed = Boolean(value) && availability === "d";
                  const violation = Boolean(value) && availability === "x";
                  const track = value ? trackById.get(value.trackId) : undefined;
                  const roleName = value ? (roleNameById.get(value.roleId) ?? value.roleId) : "";
                  return (
                    <td key={col.applicationId}>
                      <button
                        type="button"
                        onClick={() => onCellClick(col.applicationId, slot.id)}
                        aria-label={`${col.name} / ${slot.start}–${slot.end}${
                          track
                            ? `：${track.name} ${roleName}`
                            : availability === "x"
                              ? "：稼働不可"
                              : "：空き"
                        }`}
                        className={cellClass(Boolean(value), availability, softUsed, violation)}
                        style={track ? { backgroundColor: `${track.color}26` } : undefined}
                      >
                        {value ? (
                          <>
                            <span className="role">{roleName}</span>
                            <span className="track">{track?.name ?? value.trackId}</span>
                          </>
                        ) : availability === "x" ? null : (
                          <span aria-hidden="true">—</span>
                        )}
                        {violation ? (
                          <span className="text-[0.66rem] font-bold text-gdg-red">稼働×</span>
                        ) : null}
                      </button>
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

/**
 * The header shows only the first-choice role (`skills[0]`, ordered by
 * `buildStaffColumns`) because a staff column is ~7rem wide — the full list
 * used to wrap to three ragged lines and push the header row taller than the
 * data. The rest stays reachable as the cell's `title`.
 */
function skillsTitle(skills: readonly { roleName: string; level: Level }[]): string {
  return skills.map((s) => `${s.roleName}:${LEVEL_LABELS[s.level]}`).join(" / ");
}

/**
 * An unassigned slot the person marked "x" gets the hatched fill instead of
 * the "—" placeholder: "nobody scheduled here" and "this person cannot work
 * here" are different facts, and the old grid rendered both as blank.
 */
function cellClass(
  assigned: boolean,
  availability: string,
  softUsed: boolean,
  violation: boolean,
): string {
  const classes = ["data-grid-cell"];
  if (!assigned) {
    classes.push(availability === "x" ? "data-grid-cell-unavail" : "data-grid-cell-empty");
  }
  if (softUsed) classes.push("data-grid-cell-soft");
  if (violation) classes.push("data-grid-cell-violate");
  return classes.join(" ");
}
