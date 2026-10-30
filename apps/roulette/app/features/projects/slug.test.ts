import { describe, expect, it } from "vitest";
import { normalizeSlug } from "./slug";

describe("normalizeSlug", () => {
  it("accepts lowercase letters, digits and inner hyphens", () => {
    expect(normalizeSlug("devfest26")).toBe("devfest26");
    expect(normalizeSlug("io-ext-kansai")).toBe("io-ext-kansai");
    expect(normalizeSlug("a")).toBe("a");
  });

  it("trims and lowercases", () => {
    expect(normalizeSlug("  DevFest26 ")).toBe("devfest26");
  });

  it("rejects bad shapes", () => {
    expect(normalizeSlug("")).toBeNull();
    expect(normalizeSlug("-devfest")).toBeNull();
    expect(normalizeSlug("devfest-")).toBeNull();
    expect(normalizeSlug("dev fest")).toBeNull();
    expect(normalizeSlug("favicon.svg")).toBeNull();
    expect(normalizeSlug("a".repeat(41))).toBeNull();
    expect(normalizeSlug(42)).toBeNull();
  });

  it("rejects paths the app itself uses", () => {
    expect(normalizeSlug("admin")).toBeNull();
    expect(normalizeSlug("signin")).toBeNull();
    expect(normalizeSlug("no-chapter")).toBeNull();
  });
});
