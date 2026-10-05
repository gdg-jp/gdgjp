import { describe, expect, it } from "vitest";
import { canRedo, canUndo } from "./cursor";
import type { HistoryState } from "./types";

const METRICS_STUB = {
  demandMin: 0,
  demandIdeal: 0,
  filled: 0,
  idealRate: 0,
  minShortage: 0,
  leadShortage: 0,
  assigned: 0,
  firstChoiceRate: 0,
  loadStdev: 0,
  loadMax: 0,
  loadMin: 0,
  softUsed: 0,
  overwork: 0,
  violationCount: 0,
};

function revisionAt(seq: number) {
  return {
    seq,
    label: `rev ${seq}`,
    actor: "Owner",
    actorId: "u1",
    kind: "generate" as const,
    groupKey: null,
    metrics: METRICS_STUB,
    createdAt: new Date().toISOString(),
  };
}

describe("canUndo / canRedo", () => {
  it("both are false when there is no history yet", () => {
    const state: HistoryState = { cursor: null, revisions: [] };
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it("both are false with a single revision (nothing before or after it)", () => {
    const state: HistoryState = { cursor: 1, revisions: [revisionAt(1)] };
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it("canUndo is true and canRedo is false when the cursor is at the newest of several", () => {
    const state: HistoryState = {
      cursor: 3,
      revisions: [revisionAt(3), revisionAt(2), revisionAt(1)],
    };
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);
  });

  it("canRedo is true and canUndo is false when the cursor is at the oldest of several", () => {
    const state: HistoryState = {
      cursor: 1,
      revisions: [revisionAt(3), revisionAt(2), revisionAt(1)],
    };
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(true);
  });

  it("both are true when the cursor sits in the middle", () => {
    const state: HistoryState = {
      cursor: 2,
      revisions: [revisionAt(3), revisionAt(2), revisionAt(1)],
    };
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(true);
  });
});
