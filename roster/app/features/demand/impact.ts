import { reconcileSlotKeys } from "~/features/schedule/reconcile";
import { type PhaseWindow, buildSlots } from "~/features/schedule/slots";
import type { Demand } from "./types";

/**
 * How many demand rows would be lost if the event's time-slot grid were
 * regenerated for a new `(start, end, stepMin)` range (docs/roster/index.md
 * §4 "前提として確認済みの事実"; docs/roster/03-demand-input.md "Design"
 * §6). Stage 02's `regenerateTimeSlots` keeps a slot's `id` only when its
 * `(start_time, end_time)` key survives the rebuild — a demand row hanging
 * off a slot whose key changed is deleted by the `ON DELETE CASCADE` on
 * `demands.time_slot_id`.
 *
 * Reuses `reconcileSlotKeys` (Stage 02) rather than re-deriving the
 * keep/remove diff — see the stage doc's "再実装しない" note.
 */
export type ExistingSlotKey = { id: string; start: string; end: string };
export type NextSlotKey = { start: string; end: string };

export type DemandLossImpact = {
  /** Number of demand rows (cells) that would be deleted. */
  lostCount: number;
  /** Distinct time-slot ids losing at least one demand row. */
  lostSlotIds: string[];
};

export type SlotRowCounts = Readonly<Record<string, number>>;

export type SlotDataLossImpact = {
  lostDemandCount: number;
  lostAvailabilityCount: number;
  lostAssignmentCount: number;
  /** Every existing slot that reconciliation will delete, including empty slots. */
  removedSlotIds: string[];
  lostSlotIds: string[];
  hasLoss: boolean;
  confirmationKey: string;
};

/**
 * All live rows that disappear when a regenerated slot is removed. Availability and assignment
 * counts are keyed by slot id and come from the selected sheet's live rows.
 */
export function slotDataLossOnSlotChange(
  existingSlots: readonly ExistingSlotKey[],
  nextSlots: readonly NextSlotKey[],
  demands: readonly Demand[],
  availabilityCounts: SlotRowCounts,
  assignmentCounts: SlotRowCounts,
): SlotDataLossImpact {
  const { lostCount: lostDemandCount, lostSlotIds } = demandLossOnSlotChange(
    existingSlots,
    nextSlots,
    demands,
  );
  const removedSlotIds = reconcileSlotKeys(existingSlots, nextSlots).remove;
  const lostAvailabilityCount = removedSlotIds.reduce(
    (total, id) => total + (availabilityCounts[id] ?? 0),
    0,
  );
  const lostAssignmentCount = removedSlotIds.reduce(
    (total, id) => total + (assignmentCounts[id] ?? 0),
    0,
  );
  const allLostSlotIds = [
    ...new Set([
      ...lostSlotIds,
      ...removedSlotIds.filter(
        (id) => (availabilityCounts[id] ?? 0) > 0 || (assignmentCounts[id] ?? 0) > 0,
      ),
    ]),
  ].sort();
  const impact = {
    lostDemandCount,
    lostAvailabilityCount,
    lostAssignmentCount,
    removedSlotIds,
    lostSlotIds: allLostSlotIds,
  };
  const hasLoss = lostDemandCount + lostAvailabilityCount + lostAssignmentCount > 0;

  return {
    ...impact,
    hasLoss,
    // The server recomputes this value at submit time, so stale previews cannot authorize
    // deletion of rows added or changed after the browser confirmation was shown.
    confirmationKey: hasLoss ? JSON.stringify(impact) : "",
  };
}

export function demandLossOnSlotChange(
  existingSlots: readonly ExistingSlotKey[],
  nextSlots: readonly NextSlotKey[],
  demands: readonly Demand[],
): DemandLossImpact {
  const { remove } = reconcileSlotKeys(existingSlots, nextSlots);
  const removedSlotIds = new Set(remove);

  // "ideal === 0" is equivalent to "no row" (types.ts module doc) — such a
  // row (if one somehow exists) carries no real demand, so its removal
  // isn't a loss to warn about.
  const lostDemands = demands.filter((d) => d.ideal > 0 && removedSlotIds.has(d.timeSlotId));

  return {
    lostCount: lostDemands.length,
    lostSlotIds: [...new Set(lostDemands.map((d) => d.timeSlotId))],
  };
}

/**
 * `lostCount` for each candidate step-size option other than the event's
 * current one — precomputed so the real "イベント設定" step-size select
 * (`~/features/events/components/EventSettingsForm`) can warn before its
 * own submit goes through, rather than only in a separate preview widget
 * nobody has to look at (docs/roster/03-demand-input.md "Design" §6: the
 * warning must appear "保存前に"). `event.stepMin` itself is omitted since
 * choosing the current value never changes the grid.
 */
export function demandLossByStepMinOption(
  event: { startTime: string; endTime: string; stepMin: number },
  phases: readonly PhaseWindow[],
  timeSlots: readonly ExistingSlotKey[],
  demands: readonly Demand[],
  stepMinOptions: readonly number[],
): Record<number, number> {
  const result: Record<number, number> = {};
  for (const stepMin of stepMinOptions) {
    if (stepMin === event.stepMin) continue;
    const nextSlots = buildSlots({ start: event.startTime, end: event.endTime, stepMin }, phases);
    result[stepMin] = demandLossOnSlotChange(timeSlots, nextSlots, demands).lostCount;
  }
  return result;
}
