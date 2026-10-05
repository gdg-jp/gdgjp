import { describe, expect, it } from "vitest";
import routes from "~/routes";
import { RESERVED_SLUGS, SLUG_RE, validateSlug } from "./slug";

describe("validateSlug", () => {
  it("accepts alphanumerics, underscore and hyphen", () => {
    expect(validateSlug("hello-world_42")).toEqual({ ok: true });
    expect(validateSlug("a")).toEqual({ ok: true });
    expect(validateSlug("my_pic-2")).toEqual({ ok: true });
    expect(validateSlug("abc123")).toEqual({ ok: true }); // 6 chars, not id-shaped
    expect(validateSlug("abcd-234")).toEqual({ ok: true }); // 8 chars but has a hyphen
  });

  it("rejects illegal characters and lengths", () => {
    expect(validateSlug("has space")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("emoji😀")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("with.dot")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("")).toEqual({ ok: false, reason: "format" });
    expect(validateSlug("x".repeat(65))).toEqual({ ok: false, reason: "format" });
  });

  it("rejects reserved names case-insensitively", () => {
    expect(validateSlug("api")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("ADMIN")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("no-chapter")).toEqual({ ok: false, reason: "reserved" });
    for (const name of RESERVED_SLUGS) {
      if (SLUG_RE.test(name)) {
        expect(validateSlug(name)).toEqual({ ok: false, reason: "reserved" });
      }
    }
  });

  it("rejects values that look like an 8-char image id", () => {
    expect(validateSlug("abcd1234")).toEqual({ ok: false, reason: "looks_like_id" });
    expect(validateSlug("ABCdef12")).toEqual({ ok: false, reason: "looks_like_id" });
  });
});

describe("RESERVED_SLUGS", () => {
  // Guards against a new top-level route being added without reserving its
  // first path segment, which would let a slug shadow it (or vice versa).
  it("covers every non-parameterized top-level route segment", () => {
    for (const route of routes) {
      const path = (route as { path?: string }).path;
      if (!path) continue; // index route
      const first = path.split("/")[0];
      if (!first || first.startsWith(":") || first === "*") continue;
      expect(RESERVED_SLUGS.has(first.toLowerCase())).toBe(true);
    }
  });
});
