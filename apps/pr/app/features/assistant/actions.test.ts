import { describe, expect, it } from "vitest";
import { type RawAction, sanitizeActions } from "./actions";

const raw = (a: Partial<RawAction>): RawAction => ({
  type: "run_plan",
  label: "計画を作る",
  scheduleItemIds: [],
  dueAt: null,
  path: null,
  instructions: null,
  ...a,
});
const context = { base: "/c/devfest", itemIds: new Set([1, 2]) };

describe("sanitizeActions", () => {
  it("keeps valid buttons and drops the rest", () => {
    const out = sanitizeActions(
      [
        raw({}),
        raw({ type: "draft_items", scheduleItemIds: [1, 9] }),
        raw({ type: "draft_items", scheduleItemIds: [9] }),
        raw({ type: "move_item", scheduleItemIds: [2], dueAt: "2026-11-09T18:00:00+09:00" }),
        raw({ type: "move_item", scheduleItemIds: [2], dueAt: "来週" }),
        raw({ type: "open_page", path: "/c/devfest/schedule" }),
        raw({ type: "open_page", path: "/c/other/schedule" }),
        raw({ type: "open_page", path: "https://evil.example/" }),
        raw({ type: "revert_brief" }),
        raw({ type: "delete_everything" }),
      ],
      context,
    );
    expect(out.map((a) => a.type)).toEqual(["run_plan", "draft_items", "move_item", "open_page"]);
    expect(out[1]?.scheduleItemIds).toEqual([1]);
    expect(out[2]?.dueAt).toBe("2026-11-09T09:00:00.000Z");
    expect(out.every((a) => a.status === "proposed")).toBe(true);
  });
});
