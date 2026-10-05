import { useEffect, useMemo, useState } from "react";
import { AVAILABILITY_LABELS } from "~/features/applications/types";
import {
  type Assignments,
  type SolverInput,
  assignmentKey,
  demandKey,
} from "~/features/solver/types";
import type { CellDrawerSelection } from "./components/CellDrawer";
import type { DemandCellSelection, DemandSuggestion } from "./components/DemandCellDrawer";
import {
  buildStaffCellCandidates,
  groupAssignmentsByApplication,
  groupAssignmentsByCell,
  suggestForRange,
} from "./grid";

const AVAILABILITY_GLYPH = AVAILABILITY_LABELS;

/**
 * `e.$id.roster.tsx`'s drawer state and derived data, split out purely to
 * keep the route file under the 400-line cap
 * (docs/roster/07-roster-manual-edit.md "制約"). Both drawers' candidate/
 * suggestion lists are computed here by calling straight into `grid.ts`
 * (which itself only calls `hardViolations`/`suggestFor` — never
 * re-implements them), against the SAME `input`/`assignments` the page's
 * `MetricsRow`/`ShortageReport` render from, so a drawer can never show a
 * number that disagrees with the page around it.
 */
export function useRosterDrawers({
  input,
  assignments,
  applicationNameById,
  slotLabelById,
  trackNameById,
  roleNameById,
  closeOnSuccess,
}: {
  input: SolverInput;
  assignments: Assignments;
  applicationNameById: Record<string, string>;
  slotLabelById: ReadonlyMap<string, string>;
  trackNameById: ReadonlyMap<string, string>;
  roleNameById: ReadonlyMap<string, string>;
  /** A fresh truthy value on a successful assign/unassign — both drawers
   * close (deselecting their cell) the moment this changes to one, the same
   * "close on success, leave open on error" contract `StaffDrawer` uses. */
  closeOnSuccess: unknown;
}) {
  const [staffSelection, setStaffSelection] = useState<CellDrawerSelection | null>(null);
  const [demandSelection, setDemandSelection] = useState<DemandCellSelection | null>(null);

  useEffect(() => {
    if (!closeOnSuccess) return;
    setStaffSelection(null);
    setDemandSelection(null);
  }, [closeOnSuccess]);

  function openStaffCell(applicationId: string, slotId: string): void {
    setStaffSelection({
      applicationId,
      applicationName: applicationNameById[applicationId] ?? applicationId,
      slotId,
      slotLabel: slotLabelById.get(slotId) ?? slotId,
    });
  }

  /** Ignored when `slotIds`' first slot has no demand for this (track, role) — a `DemandCoverageGrid` "no demand" cell isn't editable. */
  function openDemandCell(trackId: string, roleId: string, slotIds: string[]): void {
    const firstSlotId = slotIds[0];
    if (!firstSlotId || !input.demands.has(demandKey(firstSlotId, trackId, roleId))) return;
    const lastSlotId = slotIds[slotIds.length - 1];
    const startLabel = slotLabelById.get(firstSlotId)?.split("–")[0] ?? firstSlotId;
    const endLabel = (slotLabelById.get(lastSlotId) ?? lastSlotId).split("–")[1] ?? "";
    setDemandSelection({
      trackId,
      roleId,
      trackName: trackNameById.get(trackId) ?? trackId,
      roleName: roleNameById.get(roleId) ?? roleId,
      slotIds,
      label: `${startLabel}–${endLabel}`,
    });
  }

  const staffCandidates = useMemo(
    () =>
      staffSelection
        ? buildStaffCellCandidates(
            input,
            assignments,
            staffSelection.applicationId,
            staffSelection.slotId,
          )
        : [],
    [input, assignments, staffSelection],
  );
  const staffCurrent = useMemo(() => {
    if (!staffSelection) return null;
    const value = assignments.get(
      assignmentKey(staffSelection.applicationId, staffSelection.slotId),
    );
    return value ? { trackId: value.trackId, roleId: value.roleId } : null;
  }, [assignments, staffSelection]);

  const demandOccupants = useMemo(() => {
    if (!demandSelection) return [];
    const ids =
      groupAssignmentsByCell(assignments).get(
        demandKey(demandSelection.slotIds[0], demandSelection.trackId, demandSelection.roleId),
      ) ?? [];
    const appsById = new Map(
      input.applications.map((application) => [application.id, application]),
    );
    return ids.map((id) => ({
      applicationId: id,
      name: applicationNameById[id] ?? id,
      level: appsById.get(id)?.skills[demandSelection.roleId]?.level,
    }));
  }, [assignments, demandSelection, applicationNameById, input.applications]);

  const demandSuggestions = useMemo((): DemandSuggestion[] => {
    if (!demandSelection) return [];
    const appsById = new Map(input.applications.map((a) => [a.id, a]));
    const loadByApp = groupAssignmentsByApplication(assignments);
    return suggestForRange(
      input,
      assignments,
      demandSelection.slotIds,
      demandSelection.trackId,
      demandSelection.roleId,
    ).map((s) => {
      const app = appsById.get(s.applicationId);
      const pattern = input.slots
        .map((slot) => AVAILABILITY_GLYPH[app?.availability[slot.id] ?? "x"])
        .join("");
      return {
        applicationId: s.applicationId,
        name: applicationNameById[s.applicationId] ?? s.applicationId,
        category: s.category,
        pref: s.pref,
        level: app?.skills[demandSelection.roleId]?.level,
        warnings: s.warnings,
        availabilityPattern: pattern,
        loadCount: loadByApp.get(s.applicationId)?.size ?? 0,
      };
    });
  }, [input, assignments, demandSelection, applicationNameById]);

  const demandForSelection = demandSelection
    ? (input.demands.get(
        demandKey(demandSelection.slotIds[0], demandSelection.trackId, demandSelection.roleId),
      ) ?? null)
    : null;

  return {
    staffSelection,
    openStaffCell,
    closeStaffCell: () => setStaffSelection(null),
    staffCandidates,
    staffCurrent,
    demandSelection,
    openDemandCell,
    closeDemandCell: () => setDemandSelection(null),
    demandOccupants,
    demandSuggestions,
    demandForSelection,
  };
}
