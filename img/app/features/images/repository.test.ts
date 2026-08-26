import { describe, expect, it } from "vitest";
import { parseImageListCursor } from "./repository";

describe("parseImageListCursor", () => {
  it("parses a well-formed cursor", () => {
    expect(parseImageListCursor(JSON.stringify({ createdAt: 123, id: "abc" }))).toEqual({
      createdAt: 123,
      id: "abc",
    });
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseImageListCursor("not-json")).toBeUndefined();
  });

  it("returns undefined for well-formed JSON with the wrong shape", () => {
    expect(parseImageListCursor(JSON.stringify({ foo: "bar" }))).toBeUndefined();
    expect(
      parseImageListCursor(JSON.stringify({ createdAt: "not-a-number", id: "abc" })),
    ).toBeUndefined();
  });
});
