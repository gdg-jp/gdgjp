import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, SLUG_RE, generateRandomSlug, validateSlug } from "~/features/links/slug";

describe("validateSlug", () => {
  it("accepts alphanumerics, underscore and hyphen", () => {
    expect(validateSlug("hello-world_42")).toEqual({ ok: true });
    expect(validateSlug("a")).toEqual({ ok: true });
  });

  it("rejects illegal characters", () => {
    expect(validateSlug("has space")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("emoji😀")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("with.dot")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("x".repeat(65))).toEqual({ ok: false, reason: "format" });
  });

  it("rejects reserved names case-insensitively", () => {
    expect(validateSlug("dashboard")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("ADMIN")).toEqual({ ok: false, reason: "reserved" });
    for (const name of RESERVED_SLUGS) {
      if (SLUG_RE.test(name)) {
        expect(validateSlug(name)).toEqual({ ok: false, reason: "reserved" });
      }
    }
  });
});

describe("generateRandomSlug", () => {
  it("returns a slug of the requested length matching SLUG_RE", () => {
    for (let i = 0; i < 50; i++) {
      const s = generateRandomSlug(8);
      expect(s).toHaveLength(8);
      expect(SLUG_RE.test(s)).toBe(true);
    }
  });

  it("respects custom length", () => {
    expect(generateRandomSlug(12)).toHaveLength(12);
  });
});
