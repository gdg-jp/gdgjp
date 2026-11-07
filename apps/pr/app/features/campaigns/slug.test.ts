import { describe, expect, it } from "vitest";
import { normalizeSlug, slugFromName } from "./slug";

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

describe("slugFromName", () => {
  const free = () => false;
  it("uses the ASCII words of the name", () => {
    expect(slugFromName("DevFest Kansai 2026", "2026-11-07", free)).toBe("devfest-kansai-2026");
    expect(slugFromName("Ｂｕｉｌｄ with AI 関西", "2026-11-07", free)).toBe("build-with-ai");
  });
  it("falls back to the date for Japanese names and avoids taken slugs", () => {
    expect(slugFromName("関西の勉強会", "2026-11-07", free)).toBe("event-20261107");
    const taken = new Set(["devfest", "devfest-2"]);
    expect(slugFromName("DevFest", "2026-11-07", (s) => taken.has(s))).toBe("devfest-3");
  });
});
