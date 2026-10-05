import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { previewZipImport } from "./import.server";

function archive(files: Record<string, string>): ArrayBuffer {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])),
  );
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

describe("previewZipImport", () => {
  it("maps a Notion companion folder to one root page and ignores macOS files", () => {
    const preview = previewZipImport(
      "export.zip",
      archive({
        "Wiki 0123456789abcdef0123456789abcdef.md": "# Wiki",
        "Wiki/Notes 0123456789abcdef0123456789abcdef.md": "# Notes",
        "__MACOSX/._Wiki": "metadata",
        "Wiki/.DS_Store": "metadata",
      }),
    );

    expect(preview.rootTitle).toBe("Wiki");
    expect(preview.pageCount).toBe(2);
    expect(preview.markdownCount).toBe(2);
    expect(preview.skipped).toEqual([]);
  });

  it("counts CSV files and image assets", () => {
    const preview = previewZipImport(
      "export.zip",
      archive({
        "data.csv": 'name,note\nAda,"hello, world"',
        "picture.png": "not-a-real-image-but-an-asset",
      }),
    );

    expect(preview.csvCount).toBe(1);
    expect(preview.imageCount).toBe(1);
    expect(preview.pageCount).toBe(2);
  });
});
