import { describe, expect, it } from "vitest";
import { normalizeSlug } from "./slug";

describe("normalizeSlug", () => {
  it("accepts lower-case slugs of 3–40 characters", () => {
    expect(normalizeSlug("DevFest-Kansai-2026")).toBe("devfest-kansai-2026");
    expect(normalizeSlug("abc")).toBe("abc");
  });
  it("rejects short, edge-hyphen, double-hyphen and reserved slugs", () => {
    for (const bad of ["ab", "-abc", "abc-", "a--b", "new", "me", "a".repeat(41), "日本語"]) {
      expect(normalizeSlug(bad)).toBeNull();
    }
  });
});
