import { describe, expect, it } from "vitest";
import { parseFolderListCursor } from "./repository";

describe("parseFolderListCursor", () => {
  it("parses a well-formed cursor", () => {
    expect(parseFolderListCursor(JSON.stringify({ name: "logos", id: 7 }))).toEqual({
      name: "logos",
      id: 7,
    });
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseFolderListCursor("not-json")).toBeUndefined();
  });

  it("returns undefined for well-formed JSON with the wrong shape", () => {
    expect(parseFolderListCursor(JSON.stringify({ foo: "bar" }))).toBeUndefined();
    expect(parseFolderListCursor(JSON.stringify({ name: 123, id: 7 }))).toBeUndefined();
    expect(
      parseFolderListCursor(JSON.stringify({ name: "logos", id: "not-a-number" })),
    ).toBeUndefined();
  });
});
