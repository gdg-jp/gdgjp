import { reconcileSlotKeys } from "~/features/schedule/reconcile";
import { type PhaseWindow, buildSlots } from "~/features/schedule/slots";
import type { Demand } from "./types";

export type ExistingSlotKey = { id: string; start: string; end: string };
export type NextSlotKey = { start: string; end: string };

export type DemandLossImpact = {
  lostCount: number;
  lostSlotIds: string[];
};

export type SlotRowCounts = Readonly<Record<string, number>>;

export type SlotDataLossImpact = {
  lostDemandCount: number;
  lostAvailabilityCount: number;
  lostAssignmentCount: number;
  removedSlotIds: string[];
  lostSlotIds: string[];
  hasLoss: boolean;
  confirmationKey: string;
};

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

  const lostDemands = demands.filter((d) => d.ideal > 0 && removedSlotIds.has(d.timeSlotId));

  return {
    lostCount: lostDemands.length,
    lostSlotIds: [...new Set(lostDemands.map((d) => d.timeSlotId))],
  };
}

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
