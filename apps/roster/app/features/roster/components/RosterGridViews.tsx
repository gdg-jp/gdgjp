import { type ReactNode, useMemo, useState } from "react";
import type { Assignments, Demand, Report } from "~/features/solver/types";
import { matchStaffIds } from "../search";
import { ROSTER_VIEWS, ROSTER_VIEW_LABELS, type RosterView } from "../types";
import { DemandCoverageGrid } from "./DemandCoverageGrid";
import { GridSearch } from "./GridSearch";
import { RoleGrid } from "./RoleGrid";
import { StaffGrid, type StaffGridColumn } from "./StaffGrid";

type SlotView = { id: string; idx: number; start: string; end: string };
type TrackView = { id: string; name: string; color: string; sortOrder: number };
type RoleView = { id: string; name: string; sortOrder: number };

/**
 * The view switcher on `/e/:id/roster` — the segmented control, the name
 * search, and whichever of the three grids is active
 * (docs/roster/07-roster-manual-edit.md "Design" §3).
 *
 * Split out of the route so `e.$id.roster.tsx` stays under the 400-line cap
 * (`tests/architecture/file-size.test.ts`) and, more usefully, so `view` and
 * the search query live next to the grids they drive instead of alongside the
 * loader/action. The route keeps everything that talks to the server; this
 * keeps everything that is purely "what is on screen right now".
 *
 * `toolbarRight` is a slot rather than a prop bundle because the only thing
 * that goes there is Stage 08's undo/redo pair, which is history's concern,
 * not this component's.
 */
export function RosterGridViews({
  timeSlots,
  tracks,
  roles,
  staffColumns,
  assignments,
  demands,
  report,
  trackInfoById,
  roleNameById,
  applicationNameById,
  onStaffCellClick,
  onDemandCellSelect,
  toolbarRight,
}: {
  timeSlots: readonly SlotView[];
  tracks: readonly TrackView[];
  roles: readonly RoleView[];
  staffColumns: readonly StaffGridColumn[];
  assignments: Assignments;
  demands: ReadonlyMap<string, Demand>;
  report: Report;
  trackInfoById: ReadonlyMap<string, { name: string; color: string }>;
  roleNameById: ReadonlyMap<string, string>;
  applicationNameById: Record<string, string>;
  onStaffCellClick: (applicationId: string, slotId: string) => void;
  onDemandCellSelect: (trackId: string, roleId: string, slotIds: string[]) => void;
  toolbarRight?: ReactNode;
}) {
  const [view, setView] = useState<RosterView>("staff");
  const [search, setSearch] = useState("");

  // Display lookup keeps every application, so a name still resolves for
  // someone the grid wouldn't list on its own.
  const nameById = useMemo(
    () => new Map(Object.entries(applicationNameById)),
    [applicationNameById],
  );
  // Matching, though, runs over `staffColumns` — the exact set `StaffGrid`
  // renders (`buildStaffColumns` drops anyone withdrawn AND unassigned), and
  // a superset of the assigned people `RoleGrid` names. Matching over every
  // application instead would report "1名が一致" for a withdrawn, unassigned
  // person while nothing on screen highlighted or scrolled.
  const matchedIds = useMemo(
    () =>
      matchStaffIds(
        search,
        staffColumns.map((c) => ({ id: c.applicationId, name: c.name })),
      ),
    [search, staffColumns],
  );

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="segmented">
            {ROSTER_VIEWS.map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}>
                {ROSTER_VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          {toolbarRight}
        </div>
        {/* Only the two views that render names. The coverage view is counts
         * per (track × role) — a search box there could never match anything.
         * `key={view}` is load-bearing; see GridSearch's doc comment. */}
        {view !== "coverage" ? (
          <GridSearch
            key={view}
            query={search}
            onQueryChange={setSearch}
            matchCount={matchedIds.size}
          />
        ) : null}
      </div>

      {view === "staff" ? (
        <StaffGrid
          timeSlots={timeSlots}
          columns={staffColumns}
          assignments={assignments}
          trackById={trackInfoById}
          roleNameById={roleNameById}
          onCellClick={onStaffCellClick}
          matchedIds={matchedIds}
        />
      ) : null}
      {view === "role" ? (
        <RoleGrid
          timeSlots={timeSlots}
          tracks={tracks}
          roles={roles}
          demands={demands}
          assignments={assignments}
          nameById={nameById}
          onSelectCell={onDemandCellSelect}
          matchedIds={matchedIds}
        />
      ) : null}
      {view === "coverage" ? (
        <DemandCoverageGrid
          timeSlots={timeSlots}
          tracks={tracks}
          roles={roles}
          demands={demands}
          assignments={assignments}
          report={report}
          onSelectCell={onDemandCellSelect}
        />
      ) : null}
    </>
  );
}
