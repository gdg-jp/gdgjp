import { describe, expect, it } from "vitest";
import { buildUnits, scoreUnit } from "./scoring";
import type { Group, Topic } from "./topics";

const topic = (id: string, createdAt: number, groupId: string | null = null): Topic => ({
  id,
  text: id,
  createdAt,
  groupId,
  deskId: null,
});
const group = (id: string, createdAt: number): Group => ({ id, label: null, createdAt });

describe("buildUnits", () => {
  it("makes one unit per standalone topic", () => {
    const units = buildUnits([topic("a", 1), topic("b", 2)], []);
    expect(units.map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(units.every((u) => u.kind === "topic")).toBe(true);
  });

  it("folds grouped topics into one unit with the earliest createdAt", () => {
    const topics = [topic("a", 30, "g1"), topic("b", 10, "g1"), topic("c", 20, "g1")];
    const units = buildUnits(topics, [group("g1", 5)]);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ kind: "group", id: "g1", createdAt: 10 });
    expect(units[0].memberIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("drops groups with no members", () => {
    expect(buildUnits([], [group("g1", 1)])).toEqual([]);
  });
});

describe("scoreUnit", () => {
  it("sums member vote counts", () => {
    const units = buildUnits([topic("a", 1, "g1"), topic("b", 2, "g1")], [group("g1", 1)]);
    expect(scoreUnit(units[0], { a: 3, b: 4 })).toBe(7);
  });

  it("treats missing counts as zero", () => {
    const units = buildUnits([topic("a", 1)], []);
    expect(scoreUnit(units[0], {})).toBe(0);
  });
});
