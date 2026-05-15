import { describe, expect, it } from "vitest";
import { hasRole } from "./auth-utils.server";

describe("hasRole", () => {
  describe("admin", () => {
    it("satisfies all roles", () => {
      expect(hasRole("admin", "admin")).toBe(true);
      expect(hasRole("admin", "lead")).toBe(true);
      expect(hasRole("admin", "member")).toBe(true);
      expect(hasRole("admin", "viewer")).toBe(true);
    });
  });

  describe("lead", () => {
    it("satisfies lead, member, viewer but not admin", () => {
      expect(hasRole("lead", "admin")).toBe(false);
      expect(hasRole("lead", "lead")).toBe(true);
      expect(hasRole("lead", "member")).toBe(true);
      expect(hasRole("lead", "viewer")).toBe(true);
    });
  });

  describe("member", () => {
    it("satisfies member and viewer but not lead or admin", () => {
      expect(hasRole("member", "admin")).toBe(false);
      expect(hasRole("member", "lead")).toBe(false);
      expect(hasRole("member", "member")).toBe(true);
      expect(hasRole("member", "viewer")).toBe(true);
    });
  });

  describe("viewer", () => {
    it("satisfies only viewer", () => {
      expect(hasRole("viewer", "admin")).toBe(false);
      expect(hasRole("viewer", "lead")).toBe(false);
      expect(hasRole("viewer", "member")).toBe(false);
      expect(hasRole("viewer", "viewer")).toBe(true);
    });
  });

  describe("unknown role", () => {
    it("satisfies no role", () => {
      expect(hasRole("unknown", "viewer")).toBe(false);
      expect(hasRole("", "viewer")).toBe(false);
    });
  });
});
