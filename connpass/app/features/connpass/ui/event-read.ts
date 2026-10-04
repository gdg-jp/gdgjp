import type { Page } from "@cloudflare/playwright";
import type { ParticipationType } from "../event-fields";
import { scrapeConference } from "./conference";
import { type ConnpassEventModel, mapEventStatus, parseEventModel } from "./event-model";
import { type EventStatus, mapListStatus } from "./event-status";
import { waitForBoundEvent } from "./event-widgets";
import { readableText } from "./login";
import { selectors } from "./selectors";
import { scrapeSubEventRows } from "./sub-events";
import { eventEditUrl, groupEventsUrl } from "./urls";
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
  // PlaceEditView binds after its my_places request completes. Synchronize with
  // that lifecycle rather than depending on a warm Browser Run session.
  await waitForBoundEvent(page, selectors.eventEdit.place, "change");

  // Connpass replaces this widget asynchronously after domcontentloaded. Wait
  // for a selected saved place (or a populated venue cell) before reading it.
  await page.evaluate(
    async ({ nameSelector }) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const name = document.querySelector(nameSelector)?.textContent?.trim();
        const selectedPlace = document.querySelector("#FieldPlace .MyPlaces option[selected]");
        if (name || selectedPlace) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    },
    { nameSelector: selectors.eventEdit.placeVenueName },
  );

  // Browser Run's Locator text APIs can return an empty string for Connpass's
  // off-screen edit panels. Read the rendered DOM directly instead; this also
  // keeps venue extraction independent of element visibility.
  const place = await page.evaluate(
    ({ nameSelector, addressSelector }) => ({
      name: document.querySelector(nameSelector)?.textContent ?? "",
      address: document.querySelector(addressSelector)?.textContent ?? "",
    }),
    {
      nameSelector: selectors.eventEdit.placeVenueName,
      addressSelector: selectors.eventEdit.placeVenueAddress,
    },
  );
  return { name: readableText(place.name), address: readableText(place.address) };
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
  const place = await scrapePlaceFromDom(page);
  const fallback = !model
    ? {
        title: readableText(await page.locator(selectors.eventEdit.title).innerText()),
        subtitle: readableText(await page.locator(selectors.eventEdit.subtitle).innerText()),
        description: readableText(await page.locator(selectors.eventEdit.description).innerText()),
        capacityText: readableText(await page.locator(selectors.eventEdit.capacity).innerText()),
      }
    : undefined;
  // scrapeConference navigates to its own edit page, so it must be last. All
  // event fields above are read while the event-edit DOM is still loaded.
  const conference = await scrapeConference(page, eventId);

  if (!model) {
    // Fall back to the pre-alignment DOM scrape if connpass ever drops the
    // embedded model dump; keeps the endpoint degraded-but-working.
    return {
      id: String(eventId),
      groupNumericId: null,
      parentId: null,
      url: `https://connpass.com/event/${eventId}/`,
      editUrl: eventEditUrl(eventId),
      status: "draft",
      title: fallback?.title ?? "",
      subtitle: fallback?.subtitle ?? "",
      description: fallback?.description ?? "",
      eventType: "participation",
      image: null,
      ownerText: null,
      startAt: null,
      endAt: null,
      place: place.name,
      address: place.address,
      capacity: fallback?.capacityText ? Number.parseInt(fallback.capacityText, 10) || null : null,
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
