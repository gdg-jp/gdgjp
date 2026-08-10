import { describe, expect, it } from "vitest";
import { InvalidPdfExportError } from "./pdf";
import {
  DRIVE_PHASES,
  isSkippablePdfExport,
  resolveDriveFileId,
  spreadsheetUnitDescriptors,
} from "./phases";

describe("resolveDriveFileId", () => {
  it("uses the canonical ID in the source URL over malformed stored metadata", () => {
    expect(
      resolveDriveFileId(
        "https://docs.google.com/spreadsheets/d/1aBF_s3AhUjNk2lejI1qsP59IW5XnipWpK_TwN9A12uw/edit",
        "1aBF_s3AhUjNk2lejI1qsP59IW5XnipWpK_TwN9A12uw.",
      ),
    ).toBe("1aBF_s3AhUjNk2lejI1qsP59IW5XnipWpK_TwN9A12uw");
  });

  it("retains compatibility with legacy sources that only have an external ID", () => {
    expect(resolveDriveFileId("https://example.com/legacy", "legacy-file-id")).toBe(
      "legacy-file-id",
    );
  });

  it("removes trailing punctuation from a legacy external ID", () => {
    expect(
      resolveDriveFileId(
        "https://example.com/legacy",
        "1aBF_s3AhUjNk2lejI1qsP59IW5XnipWpK_TwN9A12uw.",
      ),
    ).toBe("1aBF_s3AhUjNk2lejI1qsP59IW5XnipWpK_TwN9A12uw");
  });

  it("rejects malformed legacy external IDs instead of sending them to Google", () => {
    expect(() => resolveDriveFileId("https://example.com/legacy", "bad/id")).toThrow(
      "Could not resolve Google Drive file ID",
    );
  });
});

describe("spreadsheetUnitDescriptors", () => {
  it("creates Markdown and PDF units for grids, but only PDF for object sheets", () => {
    const units = spreadsheetUnitDescriptors({
      sheets: [
        { properties: { sheetId: 10, title: "Data", index: 0, sheetType: "GRID" } },
        { properties: { sheetId: 11, title: "Chart", index: 1, sheetType: "OBJECT" } },
      ],
    });
    expect(units.map(({ unitKind, path }) => [unitKind, path])).toEqual([
      ["sheet-md", "Data.md"],
      ["sheet-pdf", "Data.pdf"],
      ["sheet-pdf", "Chart.pdf"],
    ]);
  });

  it("disambiguates duplicate sheet names without losing extensions", () => {
    const units = spreadsheetUnitDescriptors({
      sheets: [
        { properties: { sheetId: 1, title: "v1.2", index: 0, sheetType: "GRID" } },
        { properties: { sheetId: 2, title: "v1.2", index: 1, sheetType: "GRID" } },
      ],
    });
    expect(units.map((unit) => unit.path)).toEqual([
      "v1.2.md",
      "v1.2.pdf",
      "v1.2 (2).md",
      "v1.2 (2).pdf",
    ]);
  });
});

it("keeps every Drive phase reachable in order", () => {
  expect(DRIVE_PHASES).toEqual([
    "metadata",
    "enumerate",
    "content",
    "assets",
    "rewrite",
    "finalizing",
  ]);
});

it("skips only semantic failures from unofficial Sheet PDF exports", () => {
  const semantic = new InvalidPdfExportError("not a PDF");
  expect(isSkippablePdfExport("sheet-pdf", semantic)).toBe(true);
  expect(isSkippablePdfExport("file-pdf", semantic)).toBe(false);
  expect(isSkippablePdfExport("sheet-pdf", new Error("Google Drive PDF export failed (503)"))).toBe(
    false,
  );
});
