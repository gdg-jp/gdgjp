import type { Page } from "@cloudflare/playwright";
import { scrapeConference } from "./conference";
import { type ConnpassEventModel, mapEventStatus, parseEventModel } from "./event-model";
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

export type ParticipationType = {
  id?: string;
  name?: string;
  maxParticipants?: number;
  feeType?: "prepay" | "place";
  fee?: number;
  method?: "fcfs" | "lottery";
  subEventIds?: string[] | null;
};

function mapParticipationTypesFromModel(
  types: ConnpassEventModel["participation_types"],
): ParticipationType[] {
  return types.map((type) => ({
    id: String(type.id),
    name: type.name,
    maxParticipants: type.max_participants ?? undefined,
    feeType: type.join_fee != null ? "prepay" : "place",
    fee: type.join_fee ?? type.place_fee ?? undefined,
    method: type.method === "lottery" ? "lottery" : "fcfs",
  }));
}

export function parseParticipationTypes(value: unknown): ParticipationType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const types: ParticipationType[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const type: ParticipationType = {};
    if (typeof item.name === "string") type.name = item.name;
    if (typeof item.maxParticipants === "number") type.maxParticipants = item.maxParticipants;
    if (item.feeType === "prepay" || item.feeType === "place") type.feeType = item.feeType;
    if (typeof item.fee === "number") type.fee = item.fee;
    if (item.method === "fcfs" || item.method === "lottery") type.method = item.method;
    types.push(type);
  }
  return types;
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
  reservedAt?: string;
  registrationEnabled?: boolean;
  participationTypes?: ParticipationType[];
  ownerText?: string;
  participantOnlyInfo?: string;
  cancelPolicy?: string;
};

/**
 * EventEditView is constructed in an AMD `require()` callback *after*
 * DOMContentLoaded. The click-to-edit spans (`#FieldTitle`, `#FieldSubTitle`,
 * …) are already in the server HTML, so a Playwright click can succeed before
 * Backbone has bound handlers — the inline `<input>` then never appears.
 */
async function waitForEventEditReady(page: Page): Promise<void> {
  await page.locator(selectors.eventEdit.title).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => {
      const win = window as unknown as {
        jQuery?: {
          _data?: (el: Element, key: string) => { click?: unknown } | undefined;
        };
        $?: {
          _data?: (el: Element, key: string) => { click?: unknown } | undefined;
        };
      };
      const jq = win.jQuery ?? win.$;
      const root = document.getElementById("EventEditApp");
      if (!root || !jq?._data) return false;
      return Boolean(jq._data(root, "events")?.click);
    },
    undefined,
    { timeout: 30_000 },
  );
}

async function clickEditAndFill(
  page: Page,
  triggerSelector: string,
  inputSelector: string,
  value: string,
): Promise<void> {
  const trigger = page.locator(triggerSelector).first();
  await trigger.waitFor({ state: "visible", timeout: 30_000 });
  const input = page.locator(inputSelector).first();

  // Native click: a Playwright mouse click retries after the inline editor's
  // layout shift and can land on the cancel control that is injected into the
  // same trigger element.
  const deadline = Date.now() + 20_000;
  while (!(await input.isVisible().catch(() => false))) {
    if (Date.now() > deadline) break;
    await trigger.evaluate((el) => {
      (el as HTMLElement).click();
    });
    await input.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  }
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(value);

  const scopedSave = page.locator(`${triggerSelector} button.save`).first();
  const save =
    (await scopedSave.count()) > 0
      ? scopedSave
      : page.locator(selectors.eventEdit.saveButton).first();
  if ((await save.count()) > 0 && (await save.isVisible().catch(() => false))) {
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
  await waitForEventEditReady(page);
  if (fields.title !== undefined) {
    await clickEditAndFill(
      page,
      selectors.eventEdit.title,
      selectors.eventEdit.titleInput,
      fields.title,
    );
  }
  if (fields.subtitle !== undefined) {
    await clickEditAndFill(
      page,
      selectors.eventEdit.subtitle,
      selectors.eventEdit.subtitleInput,
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
  if (fields.reservedAt !== undefined) {
    await page.locator(selectors.eventEdit.reservedTrigger).first().click();
    const { date, time } = splitDateTime(fields.reservedAt);
    await page.locator(selectors.eventEdit.reservedDate).fill(date);
    await page.locator(selectors.eventEdit.reservedTime).fill(time);
    await page.locator(selectors.eventEdit.saveButton).first().click();
    await page.waitForTimeout(400);
  }
  if (fields.registrationEnabled !== undefined) {
    const trigger = fields.registrationEnabled
      ? selectors.eventEdit.eventType.participation
      : selectors.eventEdit.eventType.advertisement;
    await page.locator(trigger).first().click();
    const save = page.locator(selectors.eventEdit.eventType.saveButton).first();
    if ((await save.count()) > 0) await save.click();
    await page.waitForTimeout(400);
  }
  if (fields.participationTypes !== undefined) {
    await setParticipationTypes(page, fields.participationTypes);
  }
  if (fields.ownerText !== undefined) {
    await clickEditAndFill(
      page,
      selectors.eventEdit.ownerText,
      selectors.eventEdit.ownerTextInput,
      fields.ownerText,
    );
  }
  if (fields.participantOnlyInfo !== undefined) {
    await page.locator(selectors.eventEdit.participantOnlyInfo).first().click();
    const area = page.locator(selectors.eventEdit.participantOnlyInfoInput).first();
    await area.waitFor({ state: "visible", timeout: 10_000 });
    await area.fill(fields.participantOnlyInfo);
    const save = page.locator(selectors.eventEdit.saveButton).first();
    if ((await save.count()) > 0) await save.click();
    await page.waitForTimeout(400);
  }
  if (fields.cancelPolicy !== undefined) {
    // Lives inside the same #FieldEventType panel as participation types (only
    // visible once a paid participation type exists), so open it independently
    // here rather than coupling to setParticipationTypes's own open/save cycle.
    const { eventType } = selectors.eventEdit;
    const typesBody = page.locator(eventType.typesBody);
    if ((await typesBody.count()) === 0) {
      await page.locator(eventType.editTrigger).first().click();
      await typesBody.waitFor({ state: "visible", timeout: 10_000 });
    }
    await page.locator(selectors.eventEdit.cancelPolicyInput).fill(fields.cancelPolicy);
    const save = page.locator(eventType.saveButton).first();
    if ((await save.count()) > 0) await save.click();
    await page.waitForTimeout(400);
  }
}

export async function setParticipationTypes(page: Page, types: ParticipationType[]): Promise<void> {
  const { eventType } = selectors.eventEdit;
  const typesBody = page.locator(eventType.typesBody);
  if ((await typesBody.count()) === 0) {
    await page.locator(eventType.editTrigger).first().click();
    await typesBody.waitFor({ state: "visible", timeout: 10_000 });
  }

  let rowCount = await typesBody.locator("tr").count();
  while (rowCount < types.length) {
    await page.locator(eventType.addRow).first().click();
    await page.waitForTimeout(200);
    rowCount = await typesBody.locator("tr").count();
  }
  while (rowCount > types.length) {
    await typesBody.locator("tr").last().locator("td.ptype_name button.RemoveButton").click();
    await page.waitForTimeout(200);
    rowCount = await typesBody.locator("tr").count();
  }

  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const row = typesBody.locator("tr").nth(i);
    if (type.name !== undefined) {
      await row.locator('td.ptype_name input[type="text"]').fill(type.name);
    }
    if (type.maxParticipants !== undefined) {
      await row.locator('td.participants input[type="text"]').fill(String(type.maxParticipants));
    }
    if (type.feeType !== undefined) {
      await row.locator(`td.payment_paypal input[type="radio"][value="${type.feeType}"]`).click();
    }
    if (type.fee !== undefined) {
      const feeInputName = type.feeType === "prepay" ? "join_fee" : "place_fee";
      await row.locator(`td.payment_paypal input[name^="${feeInputName}"]`).fill(String(type.fee));
    }
    if (type.method !== undefined) {
      await row.locator("td.ptype_method select").selectOption(type.method);
    }
  }

  const save = page.locator(eventType.saveButton).first();
  if ((await save.count()) > 0) await save.click();
  await page.waitForTimeout(400);
}

export async function publishEvent(
  page: Page,
  eventId: string | number,
  options?: { postToTwitter?: boolean; comment?: string | null },
): Promise<void> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  await page.locator(selectors.eventEdit.publish).first().click();
  const confirm = page.locator(selectors.publishDialog.confirm).first();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  if (options?.comment != null) {
    await page.locator(selectors.publishDialog.comment).first().fill(options.comment);
  }
  if (options?.postToTwitter) {
    const checkbox = page.locator(selectors.publishDialog.postTwitter).first();
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  await confirm.click();
  await page.waitForTimeout(800);
}

export type EventStatus = "draft" | "published" | "canceled";

export type ScrapedEventSummary = {
  id: string;
  title: string;
  url: string;
  editUrl: string;
  status: EventStatus;
  startAt: string | null;
  endAt: string | null;
  place: string | null;
  participantsCount: number | null;
};

function mapListStatus(label: string): EventStatus {
  if (label.includes("中止")) return "canceled";
  // Only observed on the sub-event table (event-edit_サブイベント追加後.htm) —
  // the public group event list appears to never show drafts.
  if (label.includes("下書き")) return "draft";
  return "published";
}

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
      startAt: string | null;
      endAt: string | null;
      place: string;
      participantsCount: number | null;
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
      const startAt =
        card.querySelector("span.dtstart .value-title")?.getAttribute("title") ?? null;
      const endAt = card.querySelector("span.dtend .value-title")?.getAttribute("title") ?? null;
      const place = (card.querySelector("p.event_place")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const participantsText =
        card.querySelector("p.event_participants span.amount span")?.textContent ?? "";
      const participantsCount = participantsText.trim() ? Number(participantsText.trim()) : null;
      results.push({
        id: match[1],
        title: (titleLink.textContent ?? "").replace(/\s+/g, " ").trim(),
        url: titleLink.href.split("?")[0],
        status,
        startAt,
        endAt,
        place,
        participantsCount: Number.isFinite(participantsCount) ? participantsCount : null,
      });
    }
    return results;
  });

  return events.map((event) => ({
    id: event.id,
    title: event.title,
    url: event.url,
    editUrl: eventEditUrl(event.id),
    status: mapListStatus(event.status),
    startAt: event.startAt,
    endAt: event.endAt,
    place: event.place || null,
    participantsCount: event.participantsCount,
  }));
}

export type ScrapedEventDetail = {
  id: string;
  groupNumericId: number | null;
  parentId: string | null;
  url: string;
  editUrl: string;
  status: EventStatus;
  title: string;
  subtitle: string;
  description: string;
  eventType: string;
  image: string | null;
  ownerText: string | null;
  startAt: string | null;
  endAt: string | null;
  place: string;
  address: string;
  capacity: number | null;
  reservedAt: string | null;
  registrationEnabled: boolean;
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
  lotteryPublishDate: string | null;
  allowConflictJoin: boolean;
  participationTypes: ParticipationType[];
  allowReceipt: boolean;
  invoiceNumber: string | null;
  receiptIssuerName: string | null;
  receiptIssuerAddress: string | null;
  paypalEmail: string | null;
  contactDetails: string | null;
  cancelPolicy: string | null;
  participantOnlyInfo: string | null;
  subEventCount: number;
  hasSurvey: boolean;
  hasConference: boolean;
};

/**
 * The embedded model's `place` field is always null, even once a venue is
 * saved (confirmed against イベント編集_会場設定済み.html) — connpass renders
 * the venue as a separate DOM table, not through the Backbone model.
 */
async function scrapePlaceFromDom(page: Page): Promise<{ name: string; address: string }> {
  const nameCell = page.locator(selectors.eventEdit.placeVenueName).first();
  if ((await nameCell.count()) === 0) return { name: "", address: "" };
  const name = readableText(await nameCell.innerText());
  const address = readableText(
    await page
      .locator(selectors.eventEdit.placeVenueAddress)
      .first()
      .innerText()
      .catch(() => ""),
  );
  return { name, address };
}

export async function scrapeEventDetail(
  page: Page,
  eventId: string | number,
): Promise<ScrapedEventDetail> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    throw new Error("connpass_login_required");
  }

  const html = await page.content();
  const model = parseEventModel(html);

  const subEvents = await scrapeSubEventRows(page);
  const hasSurveyText = await page
    .locator(selectors.survey.hasSurveyIndicator)
    .innerText()
    .catch(() => "");
  const hasSurvey = !hasSurveyText.includes(selectors.survey.hasSurveyEmptyText);
  const conference = await scrapeConference(page, eventId);
  const place = await scrapePlaceFromDom(page);

  if (!model) {
    // Fall back to the pre-alignment DOM scrape if connpass ever drops the
    // embedded model dump; keeps the endpoint degraded-but-working.
    const title = readableText(await page.locator(selectors.eventEdit.title).innerText());
    const subtitle = readableText(await page.locator(selectors.eventEdit.subtitle).innerText());
    const description = readableText(
      await page.locator(selectors.eventEdit.description).innerText(),
    );
    const capacityText = readableText(await page.locator(selectors.eventEdit.capacity).innerText());
    return {
      id: String(eventId),
      groupNumericId: null,
      parentId: null,
      url: `https://connpass.com/event/${eventId}/`,
      editUrl: eventEditUrl(eventId),
      status: "draft",
      title,
      subtitle,
      description,
      eventType: "participation",
      image: null,
      ownerText: null,
      startAt: null,
      endAt: null,
      place: place.name,
      address: place.address,
      capacity: capacityText ? Number.parseInt(capacityText, 10) || null : null,
      reservedAt: null,
      registrationEnabled: true,
      registrationOpenAt: null,
      registrationCloseAt: null,
      lotteryPublishDate: null,
      allowConflictJoin: true,
      participationTypes: [],
      allowReceipt: false,
      invoiceNumber: null,
      receiptIssuerName: null,
      receiptIssuerAddress: null,
      paypalEmail: null,
      contactDetails: null,
      cancelPolicy: null,
      participantOnlyInfo: null,
      subEventCount: subEvents.length,
      hasSurvey,
      hasConference: conference.isActive,
    };
  }

  return {
    id: String(model.id),
    groupNumericId: model.series,
    parentId: null,
    url: model.public_url,
    editUrl: eventEditUrl(eventId),
    status: mapEventStatus(model.status),
    title: model.title,
    subtitle: model.sub_title,
    description: model.description_input,
    eventType: model.event_type,
    image: model.image,
    ownerText: model.owner_text || null,
    startAt: model.start_datetime,
    endAt: model.end_datetime,
    place: place.name,
    address: place.address,
    capacity: model.max_num,
    reservedAt: model.publish_datetime,
    registrationEnabled: model.event_type === "participation",
    registrationOpenAt: model.open_start_datetime,
    registrationCloseAt: model.open_end_datetime,
    lotteryPublishDate: model.lottery_publish_date,
    allowConflictJoin: model.allow_conflict_join,
    participationTypes: mapParticipationTypesFromModel(model.participation_types),
    allowReceipt: model.allow_receipt,
    invoiceNumber: model.invoice_number || null,
    receiptIssuerName: model.receipt_issuer_name || null,
    receiptIssuerAddress: model.receipt_issuer_address || null,
    paypalEmail: model.paypal_email || null,
    contactDetails: model.contact_details || null,
    cancelPolicy: model.cancel_policy || null,
    participantOnlyInfo: model.participant_only_info || null,
    subEventCount: subEvents.length,
    hasSurvey,
    hasConference: conference.isActive,
  };
}

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

async function scrapeSubEventRows(page: Page): Promise<ScrapedSubEvent[]> {
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
