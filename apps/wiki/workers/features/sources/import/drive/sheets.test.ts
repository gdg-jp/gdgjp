import { describe, expect, it } from "vitest";
import { sheetRange, sheetValuesToMarkdown } from "./sheets";

describe("sheetValuesToMarkdown", () => {
  it("pads ragged rows to the widest row", () => {
    expect(sheetValuesToMarkdown("People", [["Name"], ["Ada", "London"]]).markdown).toBe(
      "# People\n\n| Name |  |\n| --- | --- |\n| Ada | London |",
    );
  });

  it("escapes pipes, backslashes, and line breaks", () => {
    expect(sheetValuesToMarkdown("Data", [["a|b"], ["x\\y\nz"]]).markdown).toContain(
      "| x\\\\y<br>z |",
    );
    expect(sheetValuesToMarkdown("Data", [["a|b"]]).markdown).toContain("| a\\|b |");
  });

  it("returns only the heading for an empty sheet", () => {
    expect(sheetValuesToMarkdown("Empty", []).markdown).toBe("# Empty");
  });

  it("marks bounded output as truncated", () => {
    const result = sheetValuesToMarkdown(
      "Large",
      [
        ["A", "B"],
        ["1", "2"],
      ],
      {
        maxCells: 2,
      },
    );
    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain("This sheet was truncated during import");
    expect(result.markdown).not.toContain("| 1 | 2 |");
  });
});

describe("sheetRange", () => {
  it("quotes apostrophes for A1 notation", () => {
    expect(sheetRange("Director's notes")).toBe("'Director''s notes'");
  });
});
