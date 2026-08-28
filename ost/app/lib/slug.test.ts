import { describe, expect, it } from "vitest";
import { isReservedSlug, normalizeSlug } from "./slug";

describe("normalizeSlug", () => {
  it("accepts simple lowercase slugs", () => {
    expect(normalizeSlug("abc")).toBe("abc");
    expect(normalizeSlug("a-b-1")).toBe("a-b-1");
    expect(normalizeSlug("devfest2026")).toBe("devfest2026");
  });

  it("trims and lowercases", () => {
    expect(normalizeSlug("  DevFest  ")).toBe("devfest");
  });

  it("rejects non-strings", () => {
    expect(normalizeSlug(undefined)).toBeNull();
    expect(normalizeSlug(null)).toBeNull();
    expect(normalizeSlug(42)).toBeNull();
  });

  it("rejects empty and bad shapes", () => {
    expect(normalizeSlug("")).toBeNull();
    expect(normalizeSlug("-x")).toBeNull();
    expect(normalizeSlug("x-")).toBeNull();
    expect(normalizeSlug("a_b")).toBeNull();
    expect(normalizeSlug("a b")).toBeNull();
    expect(normalizeSlug("a.b")).toBeNull();
    expect(normalizeSlug("a".repeat(41))).toBeNull();
  });

  it("accepts exactly 40 chars", () => {
    expect(normalizeSlug("a".repeat(40))).toBe("a".repeat(40));
  });

  it("rejects reserved slugs", () => {
    expect(normalizeSlug("api")).toBeNull();
    expect(normalizeSlug("signin")).toBeNull();
    expect(normalizeSlug("admin")).toBeNull();
    expect(normalizeSlug("no-chapter")).toBeNull();
  });
});

describe("isReservedSlug", () => {
  it("flags reserved words", () => {
    expect(isReservedSlug("ws")).toBe(true);
    expect(isReservedSlug("dev")).toBe(true);
    expect(isReservedSlug("demo")).toBe(false);
  });
});
