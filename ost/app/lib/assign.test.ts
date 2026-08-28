import { describe, expect, it } from "vitest";
import { autoAssign, rankUnits } from "./assign";
import type { Unit } from "./scoring";
import type { Desk } from "./topics";

const unit = (id: string, createdAt: number): Unit => ({
  kind: "topic",
  id,
  createdAt,
  memberIds: [id],
});
const desk = (id: string, sortOrder: number): Desk => ({
  id,
  label: "",
  x: 0,
  y: 0,
  width: 160,
  height: 100,
  rotation: 0,
  sortOrder,
  createdAt: 0,
});

describe("rankUnits", () => {
  it("orders by score desc, then earliest createdAt (FCFS), then id", () => {
    const units = [unit("late", 100), unit("early", 10), unit("low", 5)];
    const ranked = rankUnits(units, { late: 5, early: 5, low: 1 });
    expect(ranked.map((u) => u.id)).toEqual(["early", "late", "low"]);
  });
});

describe("autoAssign", () => {
  it("zips ranked units onto desks by sortOrder", () => {
    const ranked = [unit("u1", 1), unit("u2", 2)];
    const desks = [desk("d2", 1), desk("d1", 0)];
    const map = autoAssign(ranked, desks);
    expect(map.get("d1")).toBe("u1");
    expect(map.get("d2")).toBe("u2");
  });

  it("stops at the shorter list", () => {
    expect(autoAssign([unit("u1", 1)], [desk("d1", 0), desk("d2", 1)]).size).toBe(1);
    expect(autoAssign([unit("u1", 1), unit("u2", 2)], [desk("d1", 0)]).size).toBe(1);
  });
});
