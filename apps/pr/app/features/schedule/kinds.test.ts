import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIND_LABELS, SCHEDULE_KINDS } from "./kinds";

describe("schedule kinds", () => {
  it("equal the set in docs/plans/pr/00-overview.md §4", () => {
    // A kind added to the plan but not here makes the plan job's output fail validation.
    const overview = readFileSync(
      new URL("../../../../../docs/plans/pr/00-overview.md", import.meta.url),
      "utf8",
    );
    const block = overview.split("`schedule_items.kind` の初期集合:")[1]?.split("。")[0] ?? "";
    const documented = [...block.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect([...SCHEDULE_KINDS].sort()).toEqual([...documented].sort());
  });
  it("all have labels", () => {
    for (const kind of SCHEDULE_KINDS) expect(KIND_LABELS[kind]).toBeTruthy();
  });
});
