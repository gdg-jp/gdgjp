import { describe, expect, it } from "vitest";
import { charDistance, diffLeaves, personalData, ruleHints } from "./edits";

describe("diffLeaves", () => {
  it("records each changed string leaf by JSON Pointer, ignoring Worker-added keys", () => {
    const before = {
      posts: [{ text: "開催決定！", attachment: { kind: "ogp" } }],
      html: "<p>a</p>",
    };
    const after = {
      posts: [{ text: "開催決定です", attachment: { kind: "image" } }],
      html: "<p>b</p>",
    };
    expect(diffLeaves(before, after)).toEqual([
      { field: "/posts/0/attachment/kind", before: "ogp", after: "image", charDistance: 4 },
      { field: "/posts/0/text", before: "開催決定！", after: "開催決定です", charDistance: 2 },
    ]);
  });
  it("counts additions and removals", () => {
    expect(diffLeaves({ a: "x" }, { b: "y" }).map((e) => e.field)).toEqual(["/a", "/b"]);
  });
});

describe("charDistance", () => {
  it("is the edit distance in characters", () => {
    expect(charDistance("kitten", "sitting")).toBe(3);
    expect(charDistance("関西", "関東")).toBe(1);
  });
});

describe("ruleHints", () => {
  it("names the rules whose result changed", () => {
    expect(
      ruleHints(
        [
          { ruleId: "A", status: "fail" },
          { ruleId: "B", status: "pass" },
        ] as never,
        [
          { ruleId: "A", status: "pass" },
          { ruleId: "B", status: "pass" },
        ] as never,
      ),
    ).toEqual(["A"]);
  });
});

describe("personalData", () => {
  it("finds emails and @handles, not URLs or decorators", () => {
    expect(
      personalData("連絡は a.b@example.com か @gdgkwansai へ。https://x.com/@me は URL"),
    ).toEqual(["a.b@example.com", "@gdgkwansai"]);
  });
});
