import { describe, expect, it } from "vitest";
import { type ExistingApplication, resolveApplication } from "./claim";

const viewer = { userId: "user_1", email: "viewer@example.com" };

describe("resolveApplication", () => {
  it("returns new when no row matches by userId or email", () => {
    const existing: ExistingApplication[] = [
      { id: "app_other", userId: "user_2", email: "someone@example.com" },
    ];
    expect(resolveApplication(existing, viewer)).toEqual({ kind: "new" });
  });

  it("returns own when a row's user_id already matches the viewer", () => {
    const existing: ExistingApplication[] = [
      { id: "app_mine", userId: "user_1", email: "old-email@example.com" },
    ];
    expect(resolveApplication(existing, viewer)).toEqual({ kind: "own", id: "app_mine" });
  });

  it("returns claimable when an unclaimed row's email matches the viewer", () => {
    const existing: ExistingApplication[] = [
      { id: "app_proxy", userId: null, email: "viewer@example.com" },
    ];
    expect(resolveApplication(existing, viewer)).toEqual({ kind: "claimable", id: "app_proxy" });
  });

  /**
   * docs/roster/04-applications.md "回帰として固定すべきテスト": userId
   * match must win over email match. Regressing this would let someone
   * whose accounts email changed re-claim by matching a stale email on a
   * *different* row instead of their own already-linked one.
   */
  it("prioritizes a userId match over an email match on a different row", () => {
    const existing: ExistingApplication[] = [
      { id: "app_by_email", userId: null, email: "viewer@example.com" },
      { id: "app_by_user", userId: "user_1", email: "changed-away@example.com" },
    ];
    expect(resolveApplication(existing, viewer)).toEqual({ kind: "own", id: "app_by_user" });
  });

  /**
   * docs/roster/04-applications.md "回帰として固定すべきテスト": a row
   * whose user_id is already set to someone else must never become
   * claimable by this viewer, even when its email happens to match.
   * Regressing this would let one person hijack another's registration.
   */
  it("never treats an already-claimed row as claimable, even with a matching email", () => {
    const existing: ExistingApplication[] = [
      { id: "app_claimed", userId: "user_2", email: "viewer@example.com" },
    ];
    expect(resolveApplication(existing, viewer)).toEqual({ kind: "new" });
  });

  it("ignores rows that match neither userId nor email when picking claimable", () => {
    const existing: ExistingApplication[] = [
      { id: "app_unrelated", userId: null, email: "nobody@example.com" },
      { id: "app_proxy", userId: null, email: "viewer@example.com" },
    ];
    expect(resolveApplication(existing, viewer)).toEqual({ kind: "claimable", id: "app_proxy" });
  });
});
