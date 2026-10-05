/**
 * Domain type for a single `demands` row (docs/roster/index.md §4, §5;
 * docs/roster/03-demand-input.md "Design" §2). Field names follow the
 * solver-spec names (`min`/`ideal`), not the SQL column names
 * (`min_count`/`ideal_count`) — see `demand.server.ts`'s mapper.
 *
 * `ideal === 0` is equivalent to "this (time_slot, track, role) has no
 * demand at all" — the same meaning as the row not existing
 * (docs/roster/03-demand-input.md "Design" §1). Every function in this
 * feature that reads or writes a `Demand` must preserve that equivalence.
 */
export type Demand = {
  timeSlotId: string;
  trackId: string;
  roleId: string;
  /** Minimum headcount that must be filled. */
  min: number;
  /** Target headcount; 0 means "not needed here" (see module doc). */
  ideal: number;
  /** Minimum count of `lead`-level staff required. */
  leadMin: number;
  /** Maximum count of `new`-level staff allowed. */
  newMax: number;
};

/** The value fields of a `Demand`, without the (time_slot, track, role) key — what a matrix cell edits. */
export type DemandValue = Pick<Demand, "min" | "ideal" | "leadMin" | "newMax">;
