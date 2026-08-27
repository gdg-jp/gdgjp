import { describe, expect, it } from "vitest";
import { canAdministerContributors } from "./contributor-policy";

describe("canAdministerContributors", () => {
  it("allows an organizer", () => {
    expect(canAdministerContributors({ role: "organizer", isSuperAdmin: false })).toBe(true);
  });

  it("allows a super-admin regardless of chapter role", () => {
    expect(canAdministerContributors({ role: "member", isSuperAdmin: true })).toBe(true);
    expect(canAdministerContributors({ role: "contributor", isSuperAdmin: true })).toBe(true);
  });

  it("never lets a plain contributor or member administer contributors", () => {
    expect(canAdministerContributors({ role: "contributor", isSuperAdmin: false })).toBe(false);
    expect(canAdministerContributors({ role: "member", isSuperAdmin: false })).toBe(false);
  });
});
