import { describe, expect, it } from "vitest";
import { parseJobJson, serializeJobJson } from "./serialization";

describe("parseJobJson", () => {
  it("returns null for a null input", () => {
    expect(parseJobJson(null)).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseJobJson("{not json")).toBeNull();
  });

  it("parses well-formed JSON", () => {
    expect(parseJobJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("round-trips through serializeJobJson", () => {
    const value = { hostname: "example.com", chapterId: 5 };
    expect(parseJobJson(serializeJobJson(value))).toEqual(value);
  });
});

describe("serializeJobJson", () => {
  it("serializes an empty object for null or undefined", () => {
    expect(serializeJobJson(null)).toBe("{}");
    expect(serializeJobJson(undefined)).toBe("{}");
  });

  it("serializes arbitrary values", () => {
    expect(serializeJobJson({ ok: true })).toBe('{"ok":true}');
  });
});
