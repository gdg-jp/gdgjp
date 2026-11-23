import { hardViolations } from "~/features/solver/constraints";
import { type Suggestion, suggestFor } from "~/features/solver/suggest";
import type {
  Assignments,
  Availability,
  Demand,
  Level,
  Report,
  SolverApplication,
  SolverInput,
  SolverSlot,
  ViolationKind,
} from "~/features/solver/types";
import {
  assignmentKey,
  demandKey,
  parseAssignmentKey,
  parseDemandKey,
} from "~/features/solver/types";

export type GridColumn = { trackId: string; roleId: string };

export function gridColumnKey(trackId: string, roleId: string): string {
  return `${trackId}:${roleId}`;
}

type SortableTrack = { id: string; sortOrder: number };
type SortableRole = { id: string; sortOrder: number };

export function buildGridColumns(
  demands: ReadonlyMap<string, Demand>,
  tracks: readonly SortableTrack[],
  roles: readonly SortableRole[],
): GridColumn[] {
  const trackOrder = new Map(tracks.map((t) => [t.id, t.sortOrder]));
  const roleOrder = new Map(roles.map((r) => [r.id, r.sortOrder]));

  const seen = new Map<string, GridColumn>();
  for (const key of demands.keys()) {
    const { trackId, roleId } = parseDemandKey(key);
    const colKey = gridColumnKey(trackId, roleId);
    if (!seen.has(colKey)) seen.set(colKey, { trackId, roleId });
  }

  return [...seen.values()].sort((a, b) => {
    const trackDiff =
      (trackOrder.get(a.trackId) ?? Number.POSITIVE_INFINITY) -
      (trackOrder.get(b.trackId) ?? Number.POSITIVE_INFINITY);
    if (trackDiff !== 0) return trackDiff;
    return (
      (roleOrder.get(a.roleId) ?? Number.POSITIVE_INFINITY) -
      (roleOrder.get(b.roleId) ?? Number.POSITIVE_INFINITY)
    );
  });
}

export function groupAssignmentsByCell(assignments: Assignments): Map<string, string[]> {
  const byCell = new Map<string, string[]>();
  for (const [key, value] of assignments) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    const cellKey = demandKey(slotId, value.trackId, value.roleId);
    const list = byCell.get(cellKey);
    if (list) list.push(applicationId);
    else byCell.set(cellKey, [applicationId]);
  }
  for (const list of byCell.values()) list.sort();
  return byCell;
}

export function groupAssignmentsByApplication(
  assignments: Assignments,
): Map<string, Map<string, { trackId: string; roleId: string }>> {
  const byApp = new Map<string, Map<string, { trackId: string; roleId: string }>>();
  for (const [key, value] of assignments) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    const bySlot = byApp.get(applicationId) ?? new Map();
    bySlot.set(slotId, { trackId: value.trackId, roleId: value.roleId });
    byApp.set(applicationId, bySlot);
  }
  return byApp;
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function sameDemand(a: Demand | null, b: Demand | null): boolean {
  if (a === null || b === null) return a === b;
  return a.min === b.min && a.ideal === b.ideal && a.leadMin === b.leadMin && a.newMax === b.newMax;
}

export type RoleGridCell =
  | { kind: "start"; span: number; memberIds: string[]; demand: Demand | null }
  | { kind: "continued" };

export function buildRoleGridColumn(
  slots: readonly SolverSlot[],
  trackId: string,
  roleId: string,
  assignments: Assignments,
  demands: ReadonlyMap<string, Demand>,
): RoleGridCell[] {
  const byCell = groupAssignmentsByCell(assignments);
  const perSlot = slots.map((slot) => {
    const key = demandKey(slot.id, trackId, roleId);
    return { memberIds: byCell.get(key) ?? [], demand: demands.get(key) ?? null };
  });

  const cells: RoleGridCell[] = new Array(slots.length);
  let i = 0;
  while (i < perSlot.length) {
    let span = 1;
    while (
      i + span < perSlot.length &&
      sameMembers(perSlot[i].memberIds, perSlot[i + span].memberIds) &&
      sameDemand(perSlot[i].demand, perSlot[i + span].demand)
    ) {
      span++;
    }
    cells[i] = { kind: "start", span, memberIds: perSlot[i].memberIds, demand: perSlot[i].demand };
    for (let j = 1; j < span; j++) cells[i + j] = { kind: "continued" };
    i += span;
  }
  return cells;
}

export const VIOLATION_LABELS: Record<ViolationKind, string> = {
  newcomerOver: "初参加者が上限超過",
  soloNewcomer: "初参加者だけの枠",
  over: "理想超過",
};

export type CellReport = {
  headcountShort: number;
  leadShort: number;
  violations: ViolationKind[];
};

export function indexReportByCell(report: Report): Map<string, CellReport> {
  const byCell = new Map<string, CellReport>();
  const entry = (key: string): CellReport => {
    const existing = byCell.get(key);
    if (existing) return existing;
    const fresh: CellReport = { headcountShort: 0, leadShort: 0, violations: [] };
    byCell.set(key, fresh);
    return fresh;
  };

  for (const s of report.shortages) {
    const key = demandKey(s.slotId, s.trackId, s.roleId);
    const cell = entry(key);
    if (s.kind === "headcount") cell.headcountShort += s.amount;
    else cell.leadShort += s.amount;
  }
  for (const v of report.violations) {
    entry(demandKey(v.slotId, v.trackId, v.roleId)).violations.push(v.kind);
  }
  return byCell;
}

export type StaffCellCandidate = {
  trackId: string;
  roleId: string;
  demand: Demand;
  current: number;
  leadCurrent: number;
  newCurrent: number;
  warnings: string[];
};

export function buildStaffCellCandidates(
  input: SolverInput,
  assignments: Assignments,
  applicationId: string,
  slotId: string,
): StaffCellCandidate[] {
  const slot = input.slots.find((s) => s.id === slotId);
  if (!slot) return [];
  const app: SolverApplication = input.applications.find((a) => a.id === applicationId) ?? {
    id: applicationId,
    withdrawn: true,
    skills: {},
    availability: {},
  };
  const appsById = new Map(input.applications.map((a) => [a.id, a]));
  const byCell = groupAssignmentsByCell(assignments);
  const checkAgainst = new Map(assignments);
  checkAgainst.delete(assignmentKey(applicationId, slotId));

  const columns = new Map<string, GridColumn>();
  for (const key of input.demands.keys()) {
    const parsed = parseDemandKey(key);
    if (parsed.slotId === slotId) columns.set(gridColumnKey(parsed.trackId, parsed.roleId), parsed);
  }

  return [...columns.values()].map(({ trackId, roleId }): StaffCellCandidate => {
    const demand = input.demands.get(demandKey(slotId, trackId, roleId));
    if (!demand) throw new Error(`unreachable: ${trackId}/${roleId} was built from a demand key`);
    const memberIds = byCell.get(demandKey(slotId, trackId, roleId)) ?? [];
    let leadCurrent = 0;
    let newCurrent = 0;
    for (const id of memberIds) {
      const level = appsById.get(id)?.skills[roleId]?.level;
      if (level === "lead") leadCurrent++;
      else if (level === "new") newCurrent++;
    }
    return {
      trackId,
      roleId,
      demand,
      current: memberIds.length,
      leadCurrent,
      newCurrent,
      warnings: hardViolations(input, app, slot, trackId, roleId, checkAgainst),
    };
  });
}

export function suggestForRange(
  input: SolverInput,
  assignments: Assignments,
  slotIds: readonly string[],
  trackId: string,
  roleId: string,
): Suggestion[] {
  const [firstSlotId] = slotIds;
  if (!firstSlotId) return [];
  const currentOccupants = new Set(
    groupAssignmentsByCell(assignments).get(demandKey(firstSlotId, trackId, roleId)) ?? [],
  );
  const appsById = new Map(input.applications.map((a) => [a.id, a]));
  const slotsById = new Map(input.slots.map((s) => [s.id, s]));

  return suggestFor(input, assignments, firstSlotId, trackId, roleId)
    .filter((s) => !currentOccupants.has(s.applicationId))
    .map((s) => {
      const app = appsById.get(s.applicationId);
      if (!app) return s;
      const warnings = new Set(s.warnings);
      for (const slotId of slotIds.slice(1)) {
        const slot = slotsById.get(slotId);
        if (!slot) continue;
        for (const w of hardViolations(input, app, slot, trackId, roleId, assignments)) {
          warnings.add(w);
        }
      }
      return { ...s, warnings: [...warnings] };
    });
}

export type StaffGridColumn = {
  applicationId: string;
  name: string;
  withdrawn: boolean;
  skills: { roleName: string; level: Level }[];
  availability: Record<string, Availability>;
};

export function buildStaffColumns(
  applications: readonly { id: string; name: string; withdrawn: boolean }[],
  input: SolverInput,
  roleNameById: ReadonlyMap<string, string>,
  assignments: Assignments,
): StaffGridColumn[] {
  const solverAppById = new Map(input.applications.map((a) => [a.id, a]));
  const assignedAppIds = new Set(
    [...assignments.keys()].map((key) => parseAssignmentKey(key).applicationId),
  );

  return applications
    .filter((a) => !a.withdrawn || assignedAppIds.has(a.id))
    .map((a) => {
      const solverApp = solverAppById.get(a.id);
      return {
        applicationId: a.id,
        name: a.name,
        withdrawn: a.withdrawn,
        skills: Object.entries(solverApp?.skills ?? {})
          .map(([roleId, s]) => ({
            roleName: roleNameById.get(roleId) ?? roleId,
            level: s.level,
            pref: s.pref,
          }))
          .sort((x, y) => x.pref - y.pref || x.roleName.localeCompare(y.roleName, "ja"))
          .map(({ roleName, level }) => ({ roleName, level })),
        availability: solverApp?.availability ?? {},
      };
    });
}
