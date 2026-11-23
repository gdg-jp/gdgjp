export type Level = "lead" | "exp" | "new";

export type Pref = 1 | 2;

export type Availability = "o" | "d" | "x";

export type Demand = {
  min: number;
  ideal: number;
  leadMin: number;
  newMax: number;
};

export type SolverSlot = { id: string; idx: number };
export type SolverTrack = { id: string };
export type SolverRole = { id: string };

export type SolverApplication = {
  id: string;
  withdrawn: boolean;
  skills: Record<string, { level: Level; pref: Pref }>;
  availability: Record<string, Availability>;
};

export type SolverOptions = {
  noSoloNewcomer: boolean;
  maxConsecutive: number;
  seed: number;
};

export type SolverInput = {
  slots: SolverSlot[];
  tracks: SolverTrack[];
  roles: SolverRole[];
  demands: Map<string, Demand>;
  applications: SolverApplication[];
  options: SolverOptions;
  existingAssignments?: Assignments;
};

export type AssignmentValue = { trackId: string; roleId: string; locked: boolean };

export type Assignments = Map<string, AssignmentValue>;

export type SolveOptions = { keepLocked?: boolean; seed?: number };
export type SolverResult = { assignments: Assignments; report: Report };

export type ShortageKind = "headcount" | "lead";
export type Shortage = {
  kind: ShortageKind;
  slotId: string;
  trackId: string;
  roleId: string;
  amount: number;
};

export type ViolationKind = "newcomerOver" | "soloNewcomer" | "over";
export type Violation = {
  kind: ViolationKind;
  slotId: string;
  trackId: string;
  roleId: string;
  amount: number;
};

export type Metrics = {
  demandMin: number;
  demandIdeal: number;
  filled: number;
  idealRate: number;
  minShortage: number;
  leadShortage: number;
  assigned: number;
  firstChoiceRate: number;
  loadStdev: number;
  loadMax: number;
  loadMin: number;
  softUsed: number;
  overwork: number;
  violationCount: number;
};

export type Report = {
  shortages: Shortage[];
  violations: Violation[];
  metrics: Metrics;
};

export function demandKey(slotId: string, trackId: string, roleId: string): string {
  return `${slotId}|${trackId}|${roleId}`;
}

export function parseDemandKey(key: string): { slotId: string; trackId: string; roleId: string } {
  const [slotId, trackId, roleId] = key.split("|");
  return { slotId, trackId, roleId };
}

export function assignmentKey(applicationId: string, slotId: string): string {
  return `${applicationId}|${slotId}`;
}

export function parseAssignmentKey(key: string): { applicationId: string; slotId: string } {
  const sep = key.indexOf("|");
  return { applicationId: key.slice(0, sep), slotId: key.slice(sep + 1) };
}

export function getAvailability(app: SolverApplication, slotId: string): Availability {
  return app.availability[slotId] ?? "x";
}
