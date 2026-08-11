import type { Page } from "@cloudflare/playwright";
import { readableText } from "./login";
import { selectors } from "./selectors";

export function groupHomeUrl(groupSlug: string): string {
  return `https://${groupSlug}.connpass.com/`;
}

export function groupEventsUrl(groupSlug: string): string {
  return `https://${groupSlug}.connpass.com/event/`;
}

export function eventEditUrl(eventId: string | number): string {
  return `https://connpass.com/event/${eventId}/edit/`;
}

export async function createEventDraft(
  page: Page,
  groupSlug: string,
  title: string,
): Promise<{ eventId: string; editUrl: string }> {
  await page.goto(groupHomeUrl(groupSlug), { waitUntil: "domcontentloaded" });
  await page.locator(selectors.groupHome.createEventButton).first().click();
  const titleInput = page.locator(selectors.createDialog.titleInput).first();
  await titleInput.waitFor({ state: "visible", timeout: 10_000 });
  await titleInput.fill(title);
  await Promise.all([
    page.waitForURL(/\/event\/\d+\/edit/, { timeout: 60_000 }).catch(() => undefined),
    page.locator(selectors.createDialog.submit).first().click(),
  ]);

  const match = /\/event\/(\d+)\/edit\/?/.exec(page.url());
  if (!match) {
    throw new Error(`connpass_create_event_navigation_failed:${page.url()}`);
  }
  return { eventId: match[1], editUrl: page.url() };
}

export type EventEditFields = {
  title?: string;
  subtitle?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  place?: string;
  address?: string;
  capacity?: number;
};

async function clickEditAndFill(
  page: Page,
  triggerSelector: string,
  inputSelector: string,
  value: string,
): Promise<void> {
  await page.locator(triggerSelector).first().click();
  const input = page.locator(inputSelector).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(value);
  const save = page.locator(selectors.eventEdit.saveButton).first();
  if ((await save.count()) > 0) {
    await save.click();
    await page.waitForTimeout(400);
  } else {
    await input.press("Enter").catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

function splitDateTime(value: string): { date: string; time: string } {
  // Accept "YYYY/MM/DD HH:mm", "YYYY-MM-DDTHH:mm", or already-split "YYYY/MM/DD"
  const normalized = value.trim().replace("T", " ").replace(/-/g, "/");
  const [date, time = "00:00"] = normalized.split(/\s+/);
  return { date, time: time.slice(0, 5) };
}

export async function fillEventEdit(page: Page, fields: EventEditFields): Promise<void> {
  if (fields.title !== undefined) {
    await clickEditAndFill(
      page,
      selectors.eventEdit.title,
      `${selectors.eventEdit.title} input, ${selectors.eventEdit.inlineTextInput}`,
      fields.title,
    );
  }
  if (fields.subtitle !== undefined) {
    await clickEditAndFill(
      page,
      selectors.eventEdit.subtitle,
      `${selectors.eventEdit.subtitle} input, ${selectors.eventEdit.inlineTextInput}`,
      fields.subtitle,
    );
  }
  if (fields.description !== undefined) {
    await page.locator(selectors.eventEdit.description).first().click();
    const area = page.locator("textarea:visible, [contenteditable='true']:visible").first();
    await area.waitFor({ state: "visible", timeout: 10_000 });
    const tag = await area.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "textarea") {
      await area.fill(fields.description);
    } else {
      await area.click();
      await page.keyboard.press("Meta+A").catch(() => undefined);
      await page.keyboard.type(fields.description);
    }
    const save = page.locator(selectors.eventEdit.saveButton).first();
    if ((await save.count()) > 0) await save.click();
    await page.waitForTimeout(400);
  }
  if (fields.capacity !== undefined) {
    await clickEditAndFill(
      page,
      selectors.eventEdit.capacity,
      selectors.eventEdit.capacityInput,
      String(fields.capacity),
    );
  }
  if (fields.startAt !== undefined || fields.endAt !== undefined) {
    await page.locator(selectors.eventEdit.dates).first().click();
    if (fields.startAt !== undefined) {
      const { date, time } = splitDateTime(fields.startAt);
      await page.locator(selectors.eventEdit.startDate).fill(date);
      await page.locator(selectors.eventEdit.startTime).fill(time);
    }
    if (fields.endAt !== undefined) {
      const { date, time } = splitDateTime(fields.endAt);
      await page.locator(selectors.eventEdit.endDate).fill(date);
      await page.locator(selectors.eventEdit.endTime).fill(time);
    }
    await page.locator(selectors.eventEdit.saveButton).first().click();
    await page.waitForTimeout(400);
  }
  if (fields.place !== undefined || fields.address !== undefined) {
    // Prefer "会場を新しく設定する" path when present.
    const select = page.locator("#my_places");
    if ((await select.count()) > 0) {
      await select.selectOption("new").catch(() => undefined);
    } else {
      await page.locator(selectors.eventEdit.place).first().click();
    }
    if (fields.place !== undefined) {
      await page.locator(selectors.eventEdit.placeName).first().fill(fields.place);
    }
    if (fields.address !== undefined) {
      await page.locator(selectors.eventEdit.placeAddress).first().fill(fields.address);
    }
    const save = page.locator(selectors.eventEdit.saveButton).first();
    if ((await save.count()) > 0) await save.click();
    await page.waitForTimeout(400);
  }
}

export async function publishEvent(page: Page, eventId: string | number): Promise<void> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  await page.locator(selectors.eventEdit.publish).first().click();
  const confirm = page.locator(selectors.publishDialog.confirm).first();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  await page.waitForTimeout(800);
}

export type ScrapedEventSummary = {
  id: string;
  title: string;
  url: string;
  editUrl: string;
  status?: string;
  schedule?: string;
  place?: string;
  participants?: string;
};

export type ScrapedEventDetail = ScrapedEventSummary & {
  subtitle: string;
  description: string;
  capacity: string;
  place: string;
};

export async function scrapeGroupEvents(
  page: Page,
  groupSlug: string,
): Promise<ScrapedEventSummary[]> {
  await page.goto(groupEventsUrl(groupSlug), { waitUntil: "domcontentloaded" });
  if ((await page.locator(selectors.groupEvents.empty).count()) > 0) {
    const emptyText = await page.locator(selectors.groupEvents.empty).innerText();
    if (emptyText.includes("イベントはありません")) return [];
  }

  const events = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("div.group_event_list.vevent")];
    const results: Array<{
      id: string;
      title: string;
      url: string;
      status: string;
      schedule: string;
      place: string;
      participants: string;
    }> = [];

    for (const card of cards) {
      const titleLink =
        (card.querySelector("p.event_title a.url.summary") as HTMLAnchorElement | null) ??
        (card.querySelector("p.event_title a") as HTMLAnchorElement | null);
      if (!titleLink?.href) continue;
      const match = /\/event\/(\d+)\/?/.exec(titleLink.href);
      if (!match) continue;
      const status = (card.querySelector("span.label_status_event")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const scheduleEl = card.querySelector("p.schedule");
      let schedule = "";
      if (scheduleEl) {
        const clone = scheduleEl.cloneNode(true) as HTMLElement;
        for (const node of clone.querySelectorAll(
          "span.label_status_event, span.dtstart, span.dtend",
        )) {
          node.remove();
        }
        schedule = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      }
      const place = (card.querySelector("p.event_place")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const participants = (card.querySelector("p.event_participants")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      results.push({
        id: match[1],
        title: (titleLink.textContent ?? "").replace(/\s+/g, " ").trim(),
        url: titleLink.href.split("?")[0],
        status,
        schedule,
        place,
        participants,
      });
    }
    return results;
  });

  return events.map((event) => ({
    ...event,
    editUrl: eventEditUrl(event.id),
  }));
}

export async function scrapeEventDetail(
  page: Page,
  eventId: string | number,
): Promise<ScrapedEventDetail> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    throw new Error("connpass_login_required");
  }

  const title = readableText(await page.locator(selectors.eventEdit.title).innerText());
  const subtitle = readableText(await page.locator(selectors.eventEdit.subtitle).innerText());
  const description = readableText(await page.locator(selectors.eventEdit.description).innerText());
  const capacity = readableText(await page.locator(selectors.eventEdit.capacity).innerText());
  const place = readableText(
    await page
      .locator("#FieldPlace")
      .innerText()
      .catch(() => ""),
  );

  return {
    id: String(eventId),
    title,
    subtitle,
    description,
    capacity,
    place,
    url: `https://connpass.com/event/${eventId}/`,
    editUrl: eventEditUrl(eventId),
  };
}
