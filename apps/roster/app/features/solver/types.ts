/**
 * Solver I/O types (docs/roster/index.md §5, docs/roster/06-solver.md Design §1).
 *
 * This module defines the solver's OWN input/output shapes rather than importing
 * `Demand` / staff types from `~/features/demand` or `~/features/applications`.
 * Those features are being built in parallel (Stage 03 / 04) from the same base —
 * depending on them here would couple this stage to their file layout and create
 * merge conflicts for no benefit, since Stage 07 is the one responsible for mapping
 * real D1 rows onto these plain types. See docs/roster/06-solver.md Context
 * "再利用する既存実装" and index.md §5's opening line: "入力はプレーンなオブジェクト
 * ... UI にも D1 にも依存しない".
 *
 * Every exported symbol here is a plain type or a tiny pure helper — no D1, no
 * `fetch`, no `window`, no React (docs/roster/adr.md ADR-004).
 */

/** index.md §3 — per-role self-reported experience, always one of these 3 grades. */
export type Level = "lead" | "exp" | "new";

/** index.md §3 — 1 = first choice, 2 = can do. A role with no skill record is
 * "can't do it" everywhere except the internal pref-3 convention used for
 * sorting in `suggest.ts` (index.md §3's parenthetical). */
export type Pref = 1 | 2;

/** index.md §3 — o = available, d = available only if "o" can't fill the seat, x = not available. */
export type Availability = "o" | "d" | "x";

/** A single (time_slot × track × role) demand cell (index.md §4's `demands` table),
 * pre-flattened to the 4 numbers the solver actually reads. A cell with `ideal: 0`
 * is defined to mean "no demand here" — identical to the row not existing at all. */
export type Demand = {
  min: number;
  ideal: number;
  leadMin: number;
  newMax: number;
};

export type SolverSlot = { id: string; idx: number };
export type SolverTrack = { id: string };
export type SolverRole = { id: string };

/** A staff member's usable input to the solver — already reduced from whatever
 * `applications` / `application_skills` / `availabilities` rows Stage 07 reads. */
export type SolverApplication = {
  id: string;
  withdrawn: boolean;
  /** Only the roles this person can do. A missing entry means "can't do this role" —
   * this is what backs hardViolations' rule 2 (docs/roster/06-solver.md Design §2). */
  skills: Record<string, { level: Level; pref: Pref }>;
  /** slotId -> availability. A missing entry is treated as "x" (see `getAvailability`) —
   * the safe default for a hard constraint that must never be silently skipped. */
  availability: Record<string, Availability>;
};

export type SolverOptions = {
  /** index.md §4 `events.no_solo_newcomer` — forbids a newcomer being the last
   * person left alone in a cell with nobody experienced. */
  noSoloNewcomer: boolean;
  /** index.md §4 `events.max_consecutive` — consecutive-slot cost cutoff (§5.3). */
  maxConsecutive: number;
  /** index.md §4 `events.seed` — the mulberry32 seed. Re-running `solve` with the
   * same input and this seed must return byte-identical `Assignments`. */
  seed: number;
};

export type SolverInput = {
  /** idx ascending, 0-based, contiguous (guaranteed by Stage 02 — see
   * docs/roster/06-solver.md "前提として確認済みの事実"). */
  slots: SolverSlot[];
  tracks: SolverTrack[];
  roles: SolverRole[];
  /** key = `${slotId}|${trackId}|${roleId}` (see `demandKey`). */
  demands: Map<string, Demand>;
  applications: SolverApplication[];
  options: SolverOptions;
  /**
   * Optional seed for `opts.keepLocked` (docs/roster/06-solver.md Design's
   * "`keepLocked` オプションは実装するが UI は作らない...ソルバー側の受け口だけ
   * 用意しておく"). Only entries with `locked: true` are consulted, and only when
   * `solve(input, { keepLocked: true })` is called — a plain regenerate ignores
   * this field entirely and starts from an empty `Assignments`. This field isn't
   * populated by anything in Stage 06; it exists so Stage 07 has somewhere to pass
   * a previous run's locked rows through.
   */
  existingAssignments?: Assignments;
};

export type AssignmentValue = { trackId: string; roleId: string; locked: boolean };

/**
 * key = `${applicationId}|${slotId}`. This is the hard-constraint implementation:
 * one Map entry per (applicationId, slotId) pair makes "never assign the same
 * staff member to the same slot twice" structurally impossible to violate
 * (index.md §4 on the `assignments` table's primary key). Never change this key
 * shape (docs/roster/06-solver.md "制約").
 */
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

// ---- key helpers — the single place that knows the key string shapes ----

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

/** Missing availability is treated as "x" — see `SolverApplication.availability`'s doc comment. */
export function getAvailability(app: SolverApplication, slotId: string): Availability {
  return app.availability[slotId] ?? "x";
}
