import { describe, expect, it } from "vitest";
import { GROUP_WINDOW_MS, type RevisionHead, shouldMergeIntoHead } from "./grouping";

const HEAD_AT = "2026-01-01T00:00:00.000Z";

function headAt(overrides: Partial<RevisionHead> = {}): RevisionHead {
  return { kind: "edit", groupKey: "user_1", createdAt: HEAD_AT, ...overrides };
}

function msAfterHead(ms: number): Date {
  return new Date(new Date(HEAD_AT).getTime() + ms);
}

describe("shouldMergeIntoHead", () => {
  it("merges a same-actor edit made well within the 5-minute window", () => {
    expect(
      shouldMergeIntoHead(headAt(), { kind: "edit", groupKey: "user_1" }, msAfterHead(1000)),
    ).toBe(true);
  });

  it("merges exactly at the 5-minute boundary (inclusive)", () => {
    expect(
      shouldMergeIntoHead(
        headAt(),
        { kind: "edit", groupKey: "user_1" },
        msAfterHead(GROUP_WINDOW_MS),
      ),
    ).toBe(true);
  });

  it("does not merge 1ms past the 5-minute boundary", () => {
    expect(
      shouldMergeIntoHead(
        headAt(),
        { kind: "edit", groupKey: "user_1" },
        msAfterHead(GROUP_WINDOW_MS + 1),
      ),
    ).toBe(false);
  });

  it("does not merge once well past 5 minutes", () => {
    expect(
      shouldMergeIntoHead(
        headAt(),
        { kind: "edit", groupKey: "user_1" },
        msAfterHead(GROUP_WINDOW_MS * 3),
      ),
    ).toBe(false);
  });

  it("does not merge when the actor (groupKey) differs, even within the window", () => {
    expect(
      shouldMergeIntoHead(headAt(), { kind: "edit", groupKey: "user_2" }, msAfterHead(1000)),
    ).toBe(false);
  });

  it("a generate candidate never merges, even into an edit head within the window", () => {
    expect(
      shouldMergeIntoHead(headAt(), { kind: "generate", groupKey: "user_1" }, msAfterHead(1000)),
    ).toBe(false);
  });

  it("a generate candidate never merges regardless of groupKey match or timing", () => {
    expect(
      shouldMergeIntoHead(headAt(), { kind: "generate", groupKey: null }, msAfterHead(0)),
    ).toBe(false);
  });

  it("an edit candidate never merges into a generate head", () => {
    expect(
      shouldMergeIntoHead(
        headAt({ kind: "generate" }),
        { kind: "edit", groupKey: "user_1" },
        msAfterHead(1000),
      ),
    ).toBe(false);
  });

  it("an edit candidate never merges into a restore head", () => {
    expect(
      shouldMergeIntoHead(
        headAt({ kind: "restore", groupKey: null }),
        { kind: "edit", groupKey: "user_1" },
        msAfterHead(1000),
      ),
    ).toBe(false);
  });

  it("never merges when there is no head yet (first revision for the event)", () => {
    expect(shouldMergeIntoHead(null, { kind: "edit", groupKey: "user_1" }, new Date())).toBe(false);
  });

  it("never merges when the candidate's groupKey is null", () => {
    expect(shouldMergeIntoHead(headAt(), { kind: "edit", groupKey: null }, msAfterHead(0))).toBe(
      false,
    );
  });

  it("never merges when the head's groupKey is null", () => {
    expect(
      shouldMergeIntoHead(
        headAt({ groupKey: null }),
        { kind: "edit", groupKey: "user_1" },
        msAfterHead(0),
      ),
    ).toBe(false);
  });
});
