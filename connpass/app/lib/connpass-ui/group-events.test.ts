import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pure DOM parse of group-events.html, mirroring scrapeGroupEvents evaluate logic.
 */
function parseGroupEventsHtml(html: string) {
  const parts = html.split('<div class="group_event_list vevent">').slice(1);
  const results: Array<{ id: string; title: string; status: string }> = [];
  for (const part of parts) {
    const href = /<p class="event_title">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(
      part,
    );
    if (!href) continue;
    const idMatch = /\/event\/(\d+)\//.exec(href[1]);
    if (!idMatch) continue;
    const title = href[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const statusMatch = /<span class="label_status_event[^"]*">([\s\S]*?)<\/span>/.exec(part);
    const status = (statusMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
    results.push({ id: idMatch[1], title, status });
  }
  return results;
}

describe("group-events fixture parsing", () => {
  it("extracts event cards from group-events.html", () => {
    const html = readFileSync(join(process.cwd(), "fixtures/html/group-events.html"), "utf8");
    const events = parseGroupEventsHtml(html);
    expect(events.length).toBeGreaterThanOrEqual(10);
    expect(events.some((e) => e.title.includes("DevFest Kansai"))).toBe(true);
    expect(events.every((e) => /^\d+$/.test(e.id))).toBe(true);
    expect(events.some((e) => e.status === "開催前" || e.status === "終了")).toBe(true);
  });
});
