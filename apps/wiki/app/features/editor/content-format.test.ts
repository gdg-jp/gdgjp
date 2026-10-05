import { describe, expect, it } from "vitest";
import { canonicalMarkdown, ingestionImageKeysFromMarkdown } from "./content-format";

describe("canonicalMarkdown", () => {
  it("converts a TipTap document while preserving Markdown and arbitrary JSON", () => {
    expect(
      canonicalMarkdown(
        JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
        }),
      ),
    ).toBe("Hello");
    expect(canonicalMarkdown("# Heading\n\nText")).toBe("# Heading\n\nText");
    expect(canonicalMarkdown('{"not":"a tiptap document"}')).toBe('{"not":"a tiptap document"}');
    expect(canonicalMarkdown('{"type":"text","text":"not a document"}')).toBe(
      '{"type":"text","text":"not a document"}',
    );
    expect(canonicalMarkdown('{"type":"doc"}')).toBe('{"type":"doc"}');
  });
});

describe("ingestionImageKeysFromMarkdown", () => {
  it("extracts unique ingestion images from Markdown image links", () => {
    expect(
      ingestionImageKeysFromMarkdown(
        '![one](/api/images/ingestion/session/one.png)\n![two](</api/images/ingestion/session/two.jpg> "Two")\n![one](/api/images/ingestion/session/one.png)',
      ),
    ).toEqual(["ingestion/session/one.png", "ingestion/session/two.jpg"]);
  });
});
