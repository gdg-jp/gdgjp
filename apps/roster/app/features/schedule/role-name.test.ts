import { describe, expect, it } from "vitest";
import {
  CUSTOM_ROLE_LIMIT,
  ROLE_NAME_MAX_LENGTH,
  canCreateCustomRole,
  validateRoleName,
} from "./role-name";

const roles = [
  { id: "reception", name: "受付", custom: false },
  { id: "r1", name: "TA", custom: true },
];

describe("validateRoleName", () => {
  it("trims and accepts a new name", () => {
    expect(validateRoleName("  クローク  ", roles)).toEqual({ ok: true, name: "クローク" });
  });

  it("rejects empty and over-long names", () => {
    expect(validateRoleName("   ", roles).ok).toBe(false);
    expect(validateRoleName("あ".repeat(ROLE_NAME_MAX_LENGTH), roles).ok).toBe(true);
    expect(validateRoleName("あ".repeat(ROLE_NAME_MAX_LENGTH + 1), roles).ok).toBe(false);
  });

  it("rejects a name that matches a seeded or custom role after width and case folding", () => {
    expect(validateRoleName("受付", roles)).toEqual({
      ok: false,
      error: "「受付」という役割はすでにあります。",
    });
    expect(validateRoleName("ｔａ", roles).ok).toBe(false);
    expect(validateRoleName("Ta", roles).ok).toBe(false);
  });

  it("lets a rename keep its own name", () => {
    expect(validateRoleName("ta", roles, "r1")).toEqual({ ok: true, name: "ta" });
    expect(validateRoleName("受付", roles, "r1").ok).toBe(false);
  });
});

describe("canCreateCustomRole", () => {
  it("counts only custom roles against the limit", () => {
    const custom = Array.from({ length: CUSTOM_ROLE_LIMIT }, (_, i) => ({
      id: `c${i}`,
      name: `役割${i}`,
      custom: true,
    }));
    expect(canCreateCustomRole([...roles.slice(0, 1), ...custom.slice(1)])).toBe(true);
    expect(canCreateCustomRole([...roles.slice(0, 1), ...custom])).toBe(false);
  });
});
