import { describe, expect, it } from "vitest";
import { guessColumnMap, mapAdRows, parseCsv, toDate, toYen } from "./csv";

const csv =
  '﻿日付,キャンペーン名,費用,インプレッション,クリック\n2026/9/5,"DevFest, 告知",¥1,234,5000,80\n2026/9/6,DevFest,"2,000",6000,90\n合計,,"3,234",11000,170\n';

describe("ads CSV", () => {
  it("parses quoted fields and BOMs", () => {
    expect(parseCsv(csv)[1]).toEqual(["2026/9/5", "DevFest, 告知", "¥1", "234", "5000", "80"]);
  });
  it("normalizes yen and dates", () => {
    expect(toYen("¥12,345")).toBe(12345);
    expect(toYen("12,345.6 円")).toBe(12346);
    expect(toDate("2026/9/5")).toBe("2026-09-05");
    expect(toDate("9/5/2026")).toBe("2026-09-05");
    expect(toDate("合計")).toBeNull();
  });
  it("maps columns, skips total rows and names missing columns", () => {
    const rows = parseCsv(
      '日付,費用,インプレッション,クリック\n2026-09-05,"1,234",5000,80\n合計,"1,234",5000,80\n',
    );
    const map = guessColumnMap(rows[0] ?? []);
    expect(map).toMatchObject({
      date: "日付",
      spendYen: "費用",
      impressions: "インプレッション",
      clicks: "クリック",
    });
    const mapped = mapAdRows(rows, map);
    expect(mapped.rows).toEqual([
      {
        date: "2026-09-05",
        campaignName: null,
        adName: null,
        spendYen: 1234,
        impressions: 5000,
        clicks: 80,
        linkClicks: null,
        results: null,
      },
    ]);
    expect(mapAdRows(rows, { date: "日付" }).problems.length).toBeGreaterThan(0);
  });
});
