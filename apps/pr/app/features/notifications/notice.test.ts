import { describe, expect, it } from "vitest";
import { type Notice, collapse, groupNotices, urgencyOf } from "./notice";

const n = (
  key: string,
  group: Notice["group"],
  urgency: Notice["urgency"],
  at?: number,
): Notice => ({
  key,
  group,
  urgency,
  at,
  campaign: null,
  title: key,
  href: "/",
  action: null,
});

describe("notices", () => {
  it("rates urgency by time left", () => {
    expect(urgencyOf(null, 0)).toBe(0);
    expect(urgencyOf(-10, 0)).toBe(2);
    expect(urgencyOf(3600, 0)).toBe(2);
    expect(urgencyOf(2 * 86_400, 0)).toBe(1);
    expect(urgencyOf(10 * 86_400, 0)).toBe(0);
  });
  it("groups in a fixed order and puts the urgent and soon first", () => {
    const groups = groupNotices([
      n("later", "waiting", 0, 900),
      n("plan", "proposal", 0),
      n("soon", "waiting", 2, 500),
      n("sooner", "waiting", 2, 100),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["waiting", "proposal"]);
    expect(groups[0]?.notices.map((x) => x.key)).toEqual(["sooner", "soon", "later"]);
  });
});

describe("collapse", () => {
  it("folds more than three of a kind into one line", () => {
    const many = [1, 2, 3, 4].map((i) => n(`review:${i}`, "waiting", i === 3 ? 2 : 0, i));
    const out = collapse(
      [n("other", "waiting", 0), ...many],
      (x) => (x.key.startsWith("review:") ? "review" : null),
      (_k, list) => ({ title: `レビュー待ちが ${list.length} 件`, href: "/reviews", action: null }),
    );
    expect(out.map((x) => x.key)).toEqual(["other", "review:all"]);
    expect(out[1]?.title).toBe("レビュー待ちが 4 件");
    expect(out[1]?.urgency).toBe(2);
    expect(
      collapse(
        many.slice(0, 3),
        () => "review",
        () => ({ title: "", href: "", action: null }),
      ),
    ).toHaveLength(3);
  });
});
