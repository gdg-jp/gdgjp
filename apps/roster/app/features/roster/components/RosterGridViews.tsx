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

  const nameById = useMemo(
    () => new Map(Object.entries(applicationNameById)),
    [applicationNameById],
  );
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
