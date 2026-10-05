import { describe, expect, it } from "vitest";
import {
  HTML_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  PDF_MEDIA_TYPE,
  extensionFor,
  pathForMediaType,
} from "./media-type";
import { contentR2Key } from "./persist";

describe("source document media types", () => {
  it("uses media-specific extensions for filenames and immutable R2 keys", () => {
    expect(extensionFor(MARKDOWN_MEDIA_TYPE)).toBe(".md");
    expect(extensionFor(PDF_MEDIA_TYPE)).toBe(".pdf");
    expect(extensionFor(HTML_MEDIA_TYPE)).toBe(".html");
    expect(pathForMediaType("Sheet 1", PDF_MEDIA_TYPE)).toBe("Sheet 1.pdf");
    expect(pathForMediaType("index.md", MARKDOWN_MEDIA_TYPE)).toBe("index.md");
    expect(pathForMediaType("index", HTML_MEDIA_TYPE)).toBe("index.html");
    expect(contentR2Key("source", "document", "hash", PDF_MEDIA_TYPE)).toBe(
      "raw/source/document/hash.pdf",
    );
    expect(contentR2Key("source", "document", "hash", HTML_MEDIA_TYPE)).toBe(
      "raw/source/document/hash.html",
    );
  });
});
