import { describe, expect, it } from "vitest";
import { reconcileSlotKeys } from "./reconcile";

describe("reconcileSlotKeys", () => {
  it("keeps the id of every slot whose (start, end) key is unchanged (docs/roster/02-domain-schema.md regression: stepMin 60 -> 30 -> 60)", () => {
    const sixty = [
      { id: "s0", start: "09:00", end: "10:00" },
      { id: "s1", start: "10:00", end: "11:00" },
    ];

    const toThirty = reconcileSlotKeys(sixty, [
      { start: "09:00", end: "09:30" },
      { start: "09:30", end: "10:00" },
      { start: "10:00", end: "10:30" },
      { start: "10:30", end: "11:00" },
    ]);
    expect(toThirty.keep).toEqual([]);
    expect(toThirty.remove.sort()).toEqual(["s0", "s1"]);
    expect(toThirty.insert).toHaveLength(4);

    const backToSixty = reconcileSlotKeys(
      [
        { id: "n0", start: "09:00", end: "09:30" },
        { id: "n1", start: "09:30", end: "10:00" },
        { id: "n2", start: "10:00", end: "10:30" },
        { id: "n3", start: "10:30", end: "11:00" },
      ],
      [
        { start: "09:00", end: "10:00" },
        { start: "10:00", end: "11:00" },
      ],
    );
    expect(backToSixty.keep).toEqual([]);
    expect(backToSixty.insert).toEqual([
      { start: "09:00", end: "10:00" },
      { start: "10:00", end: "11:00" },
    ]);
  });

  it("keeps ids for keys present in both sets when only the range extends", () => {
    const existing = [
      { id: "s0", start: "09:00", end: "10:00" },
      { id: "s1", start: "10:00", end: "11:00" },
    ];
    const next = [
      { start: "09:00", end: "10:00" },
      { start: "10:00", end: "11:00" },
      { start: "11:00", end: "12:00" },
    ];
    const result = reconcileSlotKeys(existing, next);
    expect(result.keep).toEqual(existing);
    expect(result.remove).toEqual([]);
    expect(result.insert).toEqual([{ start: "11:00", end: "12:00" }]);
  });

  it("removes keys with no match and inserts keys with no existing row", () => {
    const existing = [{ id: "s0", start: "09:00", end: "10:00" }];
    const next = [{ start: "13:00", end: "14:00" }];
    const result = reconcileSlotKeys(existing, next);
    expect(result.keep).toEqual([]);
    expect(result.remove).toEqual(["s0"]);
    expect(result.insert).toEqual([{ start: "13:00", end: "14:00" }]);
  });

  it("handles empty existing and empty next", () => {
    expect(reconcileSlotKeys([], [])).toEqual({ keep: [], remove: [], insert: [] });
    expect(reconcileSlotKeys([], [{ start: "09:00", end: "10:00" }])).toEqual({
      keep: [],
      remove: [],
      insert: [{ start: "09:00", end: "10:00" }],
    });
    expect(reconcileSlotKeys([{ id: "s0", start: "09:00", end: "10:00" }], [])).toEqual({
      keep: [],
      remove: ["s0"],
      insert: [],
    });
  });
});
