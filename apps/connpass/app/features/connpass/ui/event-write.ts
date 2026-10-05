import type { Page } from "@cloudflare/playwright";
import type { EventEditFields, ParticipationType } from "../event-fields";
import {
  clickEditAndFill,
  clickScopedSave,
  closeDateTimePickers,
  isVisible,
  jqueryClick,
  openPlaceEditor,
  openUntilVisible,
  waitForBoundEvent,
  waitForEventEditReady,
} from "./event-widgets";
import { selectors } from "./selectors";
import { eventEditUrl, groupHomeUrl } from "./urls";
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

function splitDateTime(value: string): { date: string; time: string } {
  // Accept "YYYY/MM/DD HH:mm", "YYYY-MM-DDTHH:mm", or already-split "YYYY/MM/DD"
  const normalized = value.trim().replace("T", " ").replace(/-/g, "/");
  const [date, time = "00:00"] = normalized.split(/\s+/);
  return { date, time: time.slice(0, 5) };
}

async function setCapacity(page: Page, capacity: number): Promise<void> {
  const edit = selectors.eventEdit;
  if (await isVisible(page, edit.capacityTrigger)) {
    await waitForBoundEvent(page, "#FieldMaxNum", "click");
    await clickEditAndFill(
      page,
      edit.capacityTrigger,
      edit.capacityInput,
      String(capacity),
      "#FieldMaxNum",
    );
    return;
  }

  // Connpass only exposes event-level capacity for advertisement events. A
  // participation event has capacity per participation type, so mapping is
  // unambiguous only when it has exactly one type.
  await waitForBoundEvent(page, `${edit.eventType.root} .JoinOptions`, "click");
  if (!(await isVisible(page, `${edit.eventType.typesBody} input`))) {
    await openUntilVisible(page, edit.eventType.editTrigger, `${edit.eventType.typesBody} input`);
  }
  const rows = page.locator(`${edit.eventType.typesBody} tr`);
  if ((await rows.count()) !== 1) {
    throw new Error("connpass_capacity_requires_single_participation_type");
  }
  await rows.locator('td.participants input[type="text"]').fill(String(capacity));
  await clickScopedSave(page, edit.eventType.root);
}

async function setRegistrationEnabled(page: Page, enabled: boolean): Promise<void> {
  const { eventType } = selectors.eventEdit;
  await waitForBoundEvent(page, `${eventType.root} .JoinOptions`, "click");
  if (!(await isVisible(page, `${eventType.typesBody} input`))) {
    await openUntilVisible(page, eventType.editTrigger, `${eventType.typesBody} input`);
  }
  const target = enabled ? eventType.participation : eventType.advertisement;
  await page.locator(target).first().setChecked(true);
  await clickScopedSave(page, eventType.root);
}

export async function fillEventEdit(page: Page, fields: EventEditFields): Promise<void> {
  await waitForEventEditReady(page);
  const edit = selectors.eventEdit;
  if (fields.title !== undefined) {
    await clickEditAndFill(page, edit.title, edit.titleInput, fields.title);
  }
  if (fields.subtitle !== undefined) {
    await clickEditAndFill(page, edit.subtitle, edit.subtitleInput, fields.subtitle);
  }
  if (fields.description !== undefined) {
    await openUntilVisible(page, edit.description, edit.descriptionInput);
    await page.locator(edit.descriptionInput).first().fill(fields.description);
    await clickScopedSave(page, edit.description);
  }
  if (fields.capacity !== undefined) {
    await setCapacity(page, fields.capacity);
  }
  if (fields.startAt !== undefined || fields.endAt !== undefined) {
    await waitForBoundEvent(page, "#EventDates", "click");
    await openUntilVisible(page, edit.datesTrigger, edit.startDate);
    if (fields.startAt !== undefined) {
      const { date, time } = splitDateTime(fields.startAt);
      await page.locator(edit.startDate).fill(date);
      await page.locator(edit.startTime).fill(time);
      await closeDateTimePickers(page, edit.startTime);
    }
    if (fields.endAt !== undefined) {
      const { date, time } = splitDateTime(fields.endAt);
      await page.locator(edit.endDate).fill(date);
      await page.locator(edit.endTime).fill(time);
      await closeDateTimePickers(page, edit.endTime);
    }
    await clickScopedSave(page, "#EventDates");
  }
  if (fields.place !== undefined || fields.address !== undefined) {
    await openPlaceEditor(page);
    if (fields.place !== undefined) {
      await page.locator(edit.placeName).first().fill(fields.place);
    }
    if (fields.address !== undefined) {
      await page.locator(edit.placeAddress).first().fill(fields.address);
    }
    await clickScopedSave(page, edit.place);
  }
  if (fields.reservedAt !== undefined) {
    await waitForBoundEvent(page, edit.reservedRoot, "click");
    await openUntilVisible(page, edit.reservedTrigger, edit.reservedDate);
    const { date, time } = splitDateTime(fields.reservedAt);
    await page.locator(edit.reservedDate).fill(date);
    await page.locator(edit.reservedTime).fill(time);
    await closeDateTimePickers(page, edit.reservedTime);
    await clickScopedSave(page, edit.reservedRoot);
  }
  if (fields.registrationEnabled !== undefined) {
    await setRegistrationEnabled(page, fields.registrationEnabled);
  }
  if (fields.participationTypes !== undefined) {
    await setParticipationTypes(page, fields.participationTypes);
  }
  if (fields.ownerText !== undefined) {
    await clickEditAndFill(page, edit.ownerText, edit.ownerTextInput, fields.ownerText);
  }
  if (fields.checkinCode !== undefined) {
    await clickEditAndFill(page, edit.checkinCode, edit.checkinCodeInput, fields.checkinCode);
  }
  if (fields.hashtag !== undefined) {
    await clickEditAndFill(page, edit.hashtag, edit.hashtagInput, fields.hashtag);
  }
  if (fields.speakerTitle !== undefined) {
    await clickEditAndFill(page, edit.speakerTitle, edit.speakerTitleInput, fields.speakerTitle);
  }
  if (fields.participantOnlyInfo !== undefined) {
    await openUntilVisible(page, edit.participantOnlyInfo, edit.participantOnlyInfoInput);
    await page.locator(edit.participantOnlyInfoInput).first().fill(fields.participantOnlyInfo);
    await clickScopedSave(page, edit.participantOnlyInfo);
  }
  if (fields.cancelPolicy !== undefined) {
    const { eventType } = edit;
    await waitForBoundEvent(page, `${eventType.root} .JoinOptions`, "click");
    if (!(await isVisible(page, edit.cancelPolicyInput))) {
      await openUntilVisible(page, eventType.editTrigger, edit.cancelPolicyInput);
    }
    await page.locator(edit.cancelPolicyInput).fill(fields.cancelPolicy);
    const save = page.locator(eventType.saveButton).first();
    if ((await save.count()) > 0) await save.click();
    await page.waitForTimeout(400);
  }
}

export async function setParticipationTypes(page: Page, types: ParticipationType[]): Promise<void> {
  const { eventType } = selectors.eventEdit;
  await waitForBoundEvent(page, `${eventType.root} .JoinOptions`, "click");
  const typesBody = page.locator(eventType.typesBody);
  if (!(await isVisible(page, `${eventType.typesBody} input`))) {
    await openUntilVisible(page, eventType.editTrigger, `${eventType.typesBody} input`);
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
  await waitForEventEditReady(page);
  await jqueryClick(page, selectors.eventEdit.publish);
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
