import { describe, expect, it } from "vitest";
import {
  documentFirstWeek,
  markdownLineCount,
  packNextDocument,
  periodTitle,
} from "./chat-periods";

describe("packNextDocument", () => {
  // Each "message" is a line count; a document measures the sum of its lines.
  const linesByWeek: Record<string, number[]> = {
    "2026-01-05": [100],
    "2026-01-12": [150],
    "2026-02-02": [200],
    "2026-02-09": [80],
    "2026-03-02": [900],
    "2026-03-09": [10],
  };
  const weeks = Object.keys(linesByWeek);
  const load = (week: string) => linesByWeek[week] ?? [];
  const measure = (messages: number[]) => messages.reduce((sum, lines) => sum + lines, 0);

  function packAll(maxLines: number): Array<{ first: string; lines: number }> {
    const documents: Array<{ first: string; lines: number }> = [];
    for (let start = 0; start < weeks.length; ) {
      const { messages, end } = packNextDocument(weeks, start, load, measure, maxLines);
      documents.push({ first: weeks[start] as string, lines: measure(messages) });
      start = end;
    }
    return documents;
  }

  it("joins quiet weeks until the next week would take the document past the limit", () => {
    expect(packAll(500)).toEqual([
      { first: "2026-01-05", lines: 450 },
      { first: "2026-02-09", lines: 80 },
      { first: "2026-03-02", lines: 900 },
      { first: "2026-03-09", lines: 10 },
    ]);
  });

  it("keeps a week that alone exceeds the limit as its own document", () => {
    expect(packAll(50).map((document) => document.first)).toEqual(weeks);
  });

  it("returns nothing past the last week", () => {
    expect(packNextDocument(weeks, weeks.length, load, measure)).toEqual({
      messages: [],
      end: weeks.length,
    });
  });
});

describe("chat document periods", () => {
  it("titles a document from its first Monday to its last Sunday", () => {
    expect(periodTitle("2026-11-02")).toBe("2026-11-02 – 2026-11-08");
    expect(periodTitle("2026-09-07", "2026-10-26")).toBe("2026-09-07 – 2026-11-01");
  });

  it("reads the first week from a stored document path", () => {
    expect(documentFirstWeek("2026-11-02.md")).toBe("2026-11-02");
    expect(documentFirstWeek("channels/123/2026-11-02.md")).toBe("2026-11-02");
    expect(documentFirstWeek("2026-W27.md")).toBeNull();
  });

  it("counts Markdown lines without the trailing newline", () => {
    expect(markdownLineCount("# a\n\nb\n")).toBe(3);
    expect(markdownLineCount("")).toBe(0);
  });
});
