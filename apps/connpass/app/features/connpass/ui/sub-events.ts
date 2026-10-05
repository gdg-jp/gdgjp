import type { Page } from "@cloudflare/playwright";
import { type EventStatus, mapListStatus } from "./event-status";
import { selectors } from "./selectors";
import { eventEditUrl } from "./urls";
export type ScrapedSubEvent = {
  id: string;
  url: string;
  editUrl: string;
  status: EventStatus;
  title: string;
  startAt: string | null;
  endAt: string | null;
};

export async function createSubEventDraft(
  page: Page,
  parentEventId: string | number,
  title: string,
): Promise<{ eventId: string; editUrl: string }> {
  await page.goto(eventEditUrl(parentEventId), { waitUntil: "domcontentloaded" });
  await page.locator(selectors.subEvent.createButton).first().click();
  const titleInput = page.locator(selectors.subEvent.createTitleInput).first();
  await titleInput.waitFor({ state: "visible", timeout: 10_000 });
  await titleInput.fill(title);
  await Promise.all([
    page.waitForURL(/\/event\/\d+\/edit/, { timeout: 60_000 }).catch(() => undefined),
    page.locator(selectors.subEvent.createSubmit).first().click(),
  ]);

  const match = /\/event\/(\d+)\/edit\/?/.exec(page.url());
  if (!match) {
    throw new Error(`connpass_create_sub_event_navigation_failed:${page.url()}`);
  }
  return { eventId: match[1], editUrl: page.url() };
}

/**
 * Parses the sub-event table's dates cell, e.g. "2026/04/19 18:00〜2026/04/19
 * 20:00" (the `<br>` between start/end collapses in `textContent`) or "〜"
 * when unset. Unlike group-events.html's dtstart/dtend microformat spans,
 * this table renders plain JST wall-clock text with no offset, so the ISO
 * output assumes +09:00 (event-edit_サブイベント追加後.htm).
 */
function parseSubEventDatesCell(text: string): { startAt: string | null; endAt: string | null } {
  const toIso = (value: string): string | null => {
    const match = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const [, y, m, d, hh, mm] = match;
    return `${y}-${m}-${d}T${hh}:${mm}:00+09:00`;
  };
  const [start = "", end = ""] = text.split("〜");
  return { startAt: toIso(start), endAt: toIso(end) };
}

export async function scrapeSubEventRows(page: Page): Promise<ScrapedSubEvent[]> {
  if ((await page.locator(selectors.subEvent.area).count()) === 0) return [];

  const rows = await page.evaluate((emptyRowText) => {
    const trs = [...document.querySelectorAll(".SubeventEditArea table tbody tr")];
    const results: Array<{
      id: string;
      status: string;
      title: string;
      datesText: string;
    }> = [];
    for (const row of trs) {
      const text = row.textContent ?? "";
      if (text.includes(emptyRowText)) continue;
      const link = row.querySelector("a[href*='/event/']") as HTMLAnchorElement | null;
      if (!link?.href) continue;
      const match = /\/event\/(\d+)\/?/.exec(link.href);
      if (!match) continue;
      const cells = [...row.querySelectorAll("td")];
      const status = (cells[1]?.textContent ?? "").replace(/\s+/g, " ").trim();
      const datesText = (cells[2]?.textContent ?? "").trim();
      results.push({
        id: match[1],
        status,
        title: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
        datesText,
      });
    }
    return results;
  }, selectors.subEvent.emptyRowText);

  return rows.map((row) => ({
    id: row.id,
    // The row's own link target varies (public URL when published, preview
    // URL when draft — event-edit_サブイベント追加後.htm), so construct the
    // canonical public/edit URLs instead of trusting it.
    url: `https://connpass.com/event/${row.id}/`,
    editUrl: eventEditUrl(row.id),
    status: mapListStatus(row.status),
    title: row.title,
    ...parseSubEventDatesCell(row.datesText),
  }));
}

export async function scrapeSubEvents(
  page: Page,
  parentEventId: string | number,
): Promise<ScrapedSubEvent[]> {
  await page.goto(eventEditUrl(parentEventId), { waitUntil: "domcontentloaded" });
  return scrapeSubEventRows(page);
}

/** subevent-published.html / subevent-published_イベントを中止するをクリック.html */
export async function cancelSubEvent(page: Page, subEventId: string | number): Promise<void> {
  await page.goto(eventEditUrl(subEventId), { waitUntil: "domcontentloaded" });
  await page.locator(selectors.subEvent.cancelTrigger).first().click();
  const confirm = page.locator(selectors.subEvent.cancelConfirm).first();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  await page.waitForTimeout(800);
}
