import { describe, expect, it } from "vitest";
import type { Brief } from "~/features/briefs/brief";
import { conditionHolds, pendingConditions } from "./blocked-by";

const brief = (status: string) =>
  ({ sessions: [{ id: "s1", title: "S", speakerIds: [], status }] }) as unknown as Brief;
const ctx = (status = "tba") => ({
  brief: brief(status),
  itemStatus: (id: number) => (id === 7 ? "done" : "planned"),
  now: 1000,
});

describe("blocked_by", () => {
  it("resolves session:<id>:confirmed once the brief confirms the session", () => {
    expect(conditionHolds("session:s1:confirmed", ctx("tba"))).toBe(false);
    expect(conditionHolds("session:s1:confirmed", ctx("confirmed"))).toBe(true);
    expect(conditionHolds("session:s1:confirmed", ctx("public"))).toBe(true);
  });
  it("resolves item and date conditions", () => {
    expect(conditionHolds("item:7:done", ctx())).toBe(true);
    expect(conditionHolds("item:8:done", ctx())).toBe(false);
    expect(conditionHolds("date:1970-01-01T00:00:00Z", ctx())).toBe(true);
  });
  it("never resolves an unknown condition", () => {
    expect(pendingConditions(["session:s1:confirmd", "bogus"], ctx("confirmed"))).toEqual([
      "session:s1:confirmd",
      "bogus",
    ]);
  });
});
