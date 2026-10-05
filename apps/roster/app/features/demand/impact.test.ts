import { describe, expect, it } from "vitest";
import {
  demandLossByStepMinOption,
  demandLossOnSlotChange,
  slotDataLossOnSlotChange,
} from "./impact";
import type { Demand } from "./types";

function demand(timeSlotId: string, overrides: Partial<Demand> = {}): Demand {
  return {
    timeSlotId,
    trackId: "trk_1",
    roleId: "reception",
    min: 1,
    ideal: 2,
    leadMin: 0,
    newMax: 99,
    ...overrides,
  };
}

describe("demandLossOnSlotChange", () => {
  it("reports no loss when every existing slot key survives the rebuild", () => {
    const existing = [{ id: "slot_1", start: "09:00", end: "10:00" }];
    const next = [{ start: "09:00", end: "10:00" }];
    const result = demandLossOnSlotChange(existing, next, [demand("slot_1")]);
    expect(result).toEqual({ lostCount: 0, lostSlotIds: [] });
  });

  /**
   * docs/roster/03-demand-input.md "回帰として固定すべきテスト": lostCount
   * must match the number of demand rows that actually disappear — an
   * undercount here would let an owner confirm a step-size change and
   * silently lose demand data they were told was safe.
   */
  it("counts every demand row hanging off a slot whose key disappears", () => {
    const existing = [
      { id: "slot_1", start: "09:00", end: "10:00" },
      { id: "slot_2", start: "10:00", end: "11:00" },
    ];
    // Changing step size from 60 to 30 min regenerates the grid with a
    // different set of (start, end) keys entirely.
    const next = [
      { start: "09:00", end: "09:30" },
      { start: "09:30", end: "10:00" },
      { start: "10:00", end: "10:30" },
      { start: "10:30", end: "11:00" },
    ];
    const demands = [
      demand("slot_1", { trackId: "trk_1", roleId: "reception" }),
      demand("slot_1", { trackId: "trk_1", roleId: "guide" }),
      demand("slot_2", { trackId: "trk_2", roleId: "stream" }),
    ];
    const result = demandLossOnSlotChange(existing, next, demands);
    expect(result.lostCount).toBe(3);
    expect(result.lostSlotIds.sort()).toEqual(["slot_1", "slot_2"]);
  });

  it("does not count a kept slot's demand even when other slots are lost", () => {
    const existing = [
      { id: "slot_1", start: "09:00", end: "10:00" },
      { id: "slot_2", start: "10:00", end: "11:00" },
    ];
    const next = [{ start: "09:00", end: "10:00" }];
    const demands = [demand("slot_1"), demand("slot_2")];
    const result = demandLossOnSlotChange(existing, next, demands);
    expect(result).toEqual({ lostCount: 1, lostSlotIds: ["slot_2"] });
  });

  it("ignores an ideal=0 row on a removed slot — it's equivalent to no row, so nothing is lost", () => {
    const existing = [{ id: "slot_1", start: "09:00", end: "10:00" }];
    const next: { start: string; end: string }[] = [];
    const demands = [demand("slot_1", { ideal: 0, min: 0, leadMin: 0, newMax: 0 })];
    const result = demandLossOnSlotChange(existing, next, demands);
    expect(result).toEqual({ lostCount: 0, lostSlotIds: [] });
  });

  it("deduplicates lostSlotIds when one slot loses multiple demand rows", () => {
    const existing = [{ id: "slot_1", start: "09:00", end: "10:00" }];
    const next: { start: string; end: string }[] = [];
    const demands = [
      demand("slot_1", { roleId: "reception" }),
      demand("slot_1", { roleId: "guide" }),
    ];
    const result = demandLossOnSlotChange(existing, next, demands);
    expect(result.lostCount).toBe(2);
    expect(result.lostSlotIds).toEqual(["slot_1"]);
  });
});

describe("slotDataLossOnSlotChange", () => {
  it("requires confirmation when a removed slot only has staff availability rows", () => {
    const result = slotDataLossOnSlotChange(
      [{ id: "slot_1", start: "09:00", end: "10:00" }],
      [],
      [],
      { slot_1: 3 },
      {},
    );

    expect(result).toMatchObject({
      lostDemandCount: 0,
      lostAvailabilityCount: 3,
      lostAssignmentCount: 0,
      lostSlotIds: ["slot_1"],
      hasLoss: true,
    });
    expect(result.confirmationKey).toBeTruthy();
  });

  it("counts demands, availability, and assignments on removed slots only", () => {
    const result = slotDataLossOnSlotChange(
      [
        { id: "slot_1", start: "09:00", end: "10:00" },
        { id: "slot_2", start: "10:00", end: "11:00" },
      ],
      [{ start: "10:00", end: "11:00" }],
      [demand("slot_1"), demand("slot_2")],
      { slot_1: 2, slot_2: 5 },
      { slot_1: 1, slot_2: 4 },
    );

    expect(result).toMatchObject({
      lostDemandCount: 1,
      lostAvailabilityCount: 2,
      lostAssignmentCount: 1,
      lostSlotIds: ["slot_1"],
      hasLoss: true,
    });
  });

  it("returns no confirmation key when changed settings keep every live slot", () => {
    const result = slotDataLossOnSlotChange(
      [{ id: "slot_1", start: "09:00", end: "10:00" }],
      [{ start: "09:00", end: "10:00" }],
      [],
      { slot_1: 2 },
      { slot_1: 1 },
    );

    expect(result).toMatchObject({
      lostDemandCount: 0,
      lostAvailabilityCount: 0,
      lostAssignmentCount: 0,
      lostSlotIds: [],
      hasLoss: false,
      confirmationKey: "",
    });
  });
});

describe("demandLossByStepMinOption", () => {
  const event = { startTime: "09:00", endTime: "11:00", stepMin: 60 };
  const existingSlots = [
    { id: "slot_1", start: "09:00", end: "10:00" },
    { id: "slot_2", start: "10:00", end: "11:00" },
  ];

  it("omits the event's current step size — choosing it changes nothing", () => {
    const result = demandLossByStepMinOption(event, [], existingSlots, [], [15, 30, 60]);
    expect(Object.keys(result).sort()).toEqual(["15", "30"]);
  });

  /**
   * This is the exact gap the stage doc's manual E2E step 10 and
   * completion condition #7 describe: the real "イベント設定" step-size
   * select must be able to warn *before* its own submit goes through, not
   * only via a separate, disconnected preview. This function is what makes
   * that possible without a server round trip at submit time.
   */
  it("reports lostCount per candidate option, matching demandLossOnSlotChange for that option", () => {
    const demands = [demand("slot_1"), demand("slot_2")];
    const result = demandLossByStepMinOption(event, [], existingSlots, demands, [15, 30, 60]);
    // 60 -> 30/15 min regenerates the grid with entirely different
    // (start, end) keys, so both existing slots' demand is lost either way.
    expect(result[30]).toBe(2);
    expect(result[15]).toBe(2);
  });

  it("reports 0 when a candidate option loses no demand", () => {
    const result = demandLossByStepMinOption(event, [], existingSlots, [], [30]);
    expect(result[30]).toBe(0);
  });
});
