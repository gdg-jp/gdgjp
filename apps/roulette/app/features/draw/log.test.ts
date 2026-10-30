import { describe, expect, it } from "vitest";
import { drawLogCsv, formatDrawDateTime } from "./log";

describe("drawLogCsv", () => {
  it("lists spins oldest first in Japan time, quoted, with a BOM", () => {
    const csv = drawLogCsv([
      { number: 2, name: 'ステッカー "GDG"', rank: 2, createdAt: 1793334785 },
      { number: 1, name: "Google Pixel 10", rank: 1, createdAt: 1793334725 },
      { number: 3, name: "ハズレ", rank: null, createdAt: 1793334845 },
    ]);
    expect(csv).toBe(
      '﻿"No.","日時","等級","景品"\r\n' +
        '"1","2026-10-30 13:32:05","1 等","Google Pixel 10"\r\n' +
        '"2","2026-10-30 13:33:05","2 等","ステッカー ""GDG"""\r\n' +
        '"3","2026-10-30 13:34:05","ハズレ","ハズレ"\r\n',
    );
  });

  it("keeps prize names from running as spreadsheet formulas", () => {
    const csv = drawLogCsv([{ number: 1, name: "=HYPERLINK(1)", rank: 1, createdAt: 0 }]);
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
  });
});

describe("formatDrawDateTime", () => {
  it("formats in Japan time", () => {
    expect(formatDrawDateTime(0)).toBe("1970-01-01 09:00:00");
  });
});
