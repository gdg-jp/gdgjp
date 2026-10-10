import { describe, expect, it } from "vitest";
import { invitableChapterIds, inviteState, inviteUrl, parseExpiryDays } from "./invite-policy";

describe("invite policy", () => {
  it("classifies invites by revocation and expiry", () => {
    expect(inviteState({ expiresAt: 200, revokedAt: null }, 100)).toBe("valid");
    expect(inviteState({ expiresAt: 100, revokedAt: null }, 100)).toBe("expired");
    expect(inviteState({ expiresAt: 200, revokedAt: 50 }, 100)).toBe("revoked");
  });

  it("only accepts the offered expiry durations", () => {
    expect(parseExpiryDays("1")).toBe(1);
    expect(parseExpiryDays("7")).toBe(7);
    expect(parseExpiryDays("30")).toBe(30);
    for (const raw of ["0", "", null, "never", "365", "-7", "7.5"]) {
      expect(parseExpiryDays(raw)).toBeNull();
    }
  });

  it("limits invitable chapters to active organizer memberships", () => {
    expect(
      invitableChapterIds([
        { chapterId: 1, role: "organizer", status: "active" },
        { chapterId: 2, role: "member", status: "active" },
        { chapterId: 3, role: "organizer", status: "pending" },
      ]),
    ).toEqual([1]);
  });

  it("builds absolute invite URLs on the app origin", () => {
    expect(inviteUrl("https://accounts.gdgs.jp", "abc_-1")).toBe(
      "https://accounts.gdgs.jp/invite/abc_-1",
    );
  });
});
