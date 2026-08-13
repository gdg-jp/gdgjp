import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixturesDir = join(process.cwd(), "fixtures/html");

/**
 * Pure re-implementation of scrapeSubEventRows's evaluate() + post-processing,
 * mirroring group-events.test.ts's style: parse the raw fixture HTML directly
 * rather than driving a real Playwright page.
 */
function parseSubEventRows(html: string) {
  const rowsHtml = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const results: Array<{
    id: string;
    url: string;
    status: "draft" | "published" | "canceled";
    title: string;
    startAt: string | null;
    endAt: string | null;
  }> = [];

  for (const row of rowsHtml) {
    if (row.includes("サブイベントは作成されていません")) continue;
    const hrefMatch = /href="([^"]*\/event\/(\d+)\/[^"]*)"[^>]*>([^<]*)</.exec(row);
    if (!hrefMatch) continue;
    const id = hrefMatch[2];
    const title = hrefMatch[3].trim();

    const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    const statusText = cells[1] ?? "";
    const status = statusText.includes("下書き") ? "draft" : "published";

    const datesText = (cells[2] ?? "").replace(/\s+/g, "");
    const [start = "", end = ""] = datesText.split("〜");
    const toIso = (v: string) => {
      const m = /^(\d{4})\/(\d{2})\/(\d{2})(\d{2}):(\d{2})$/.exec(v);
      if (!m) return null;
      const [, y, mo, d, hh, mm] = m;
      return `${y}-${mo}-${d}T${hh}:${mm}:00+09:00`;
    };

    results.push({
      id,
      url: `https://connpass.com/event/${id}/`,
      status,
      title,
      startAt: toIso(start),
      endAt: toIso(end),
    });
  }
  return results;
}

describe("sub-event table parsing", () => {
  const fixture = join(fixturesDir, "event-edit_サブイベント追加後.htm");

  it.skipIf(!existsSync(fixture))(
    "extracts published and draft sub-event rows with correct status/dates",
    () => {
      const html = readFileSync(fixture, "utf8");
      const rows = parseSubEventRows(html);

      expect(rows).toHaveLength(2);

      const published = rows.find((r) => r.id === "403753");
      expect(published).toBeDefined();
      expect(published?.status).toBe("published");
      expect(published?.title).toBe("サブイベント1");
      expect(published?.startAt).toBe("2026-04-19T18:00:00+09:00");
      expect(published?.endAt).toBe("2026-04-19T20:00:00+09:00");
      expect(published?.url).toBe("https://connpass.com/event/403753/");

      const draft = rows.find((r) => r.id === "403755");
      expect(draft).toBeDefined();
      expect(draft?.status).toBe("draft");
      expect(draft?.title).toBe("サブイベント2");
      expect(draft?.startAt).toBeNull();
      expect(draft?.endAt).toBeNull();
    },
  );
});
