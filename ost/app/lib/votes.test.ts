import { describe, expect, it } from "vitest";
import { hasVoted, tallyVotes } from "./votes";

describe("tallyVotes", () => {
  it("returns an empty map for no rows", () => {
    expect(tallyVotes([])).toEqual({});
  });

  it("counts votes per topic", () => {
    expect(tallyVotes([{ topicId: "a" }, { topicId: "a" }, { topicId: "b" }])).toEqual({
      a: 2,
      b: 1,
    });
  });
});

describe("hasVoted", () => {
  it("checks membership", () => {
    expect(hasVoted(["a", "b"], "b")).toBe(true);
    expect(hasVoted(new Set(["a"]), "b")).toBe(false);
  });
});
