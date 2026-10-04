import type { Page } from "@cloudflare/playwright";
import { selectors } from "./selectors";

export function conferenceEditUrl(eventId: string | number): string {
  return `https://connpass.com/event/${eventId}/conference_edit/`;
}

export type ScrapedConference = {
  isActive: boolean;
  lpUrl: string | null;
  cfpUrl: string | null;
  cfpStartAt: string | null;
  cfpEndAt: string | null;
  sponsorUrl: string | null;
  sponsorStartAt: string | null;
  sponsorEndAt: string | null;
  topics: string[];
};

async function inputValue(page: Page, selector: string): Promise<string> {
  return (
    await page
      .locator(selector)
      .inputValue()
      .catch(() => "")
  ).trim();
}

export async function scrapeConference(
  page: Page,
  eventId: string | number,
): Promise<ScrapedConference> {
  await page.goto(conferenceEditUrl(eventId), { waitUntil: "domcontentloaded" });
  const { conference } = selectors;

  const isActive = await page
    .locator(conference.isActive)
    .isChecked()
    .catch(() => false);
  const lpUrl = await inputValue(page, conference.lpUrl);
  const cfpUrl = await inputValue(page, conference.cfpUrl);
  const cfpStartAt = await inputValue(page, conference.cfpStartAt);
  const cfpEndAt = await inputValue(page, conference.cfpEndAt);
  const sponsorUrl = await inputValue(page, conference.sponsorUrl);
  const sponsorStartAt = await inputValue(page, conference.sponsorStartAt);
  const sponsorEndAt = await inputValue(page, conference.sponsorEndAt);
  const topics = await page
    .locator(conference.topics)
    .locator("option:checked")
    .allTextContents()
    .catch(() => [] as string[]);

  return {
    isActive,
    lpUrl: lpUrl || null,
    cfpUrl: cfpUrl || null,
    cfpStartAt: cfpStartAt || null,
    cfpEndAt: cfpEndAt || null,
    sponsorUrl: sponsorUrl || null,
    sponsorStartAt: sponsorStartAt || null,
    sponsorEndAt: sponsorEndAt || null,
    topics: topics.map((t) => t.trim()).filter(Boolean),
  };
}

export type UpsertConferenceInput = {
  isActive: boolean;
  lpUrl?: string | null;
  cfpUrl?: string | null;
  cfpStartAt?: string | null;
  cfpEndAt?: string | null;
  sponsorUrl?: string | null;
  sponsorStartAt?: string | null;
  sponsorEndAt?: string | null;
  topics?: string[] | null;
};

async function fillOrClear(
  page: Page,
  selector: string,
  value: string | null | undefined,
): Promise<void> {
  const locator = page.locator(selector);
  if ((await locator.count()) === 0) return;
  await locator.fill(value ?? "");
}

export async function upsertConference(
  page: Page,
  eventId: string | number,
  input: UpsertConferenceInput,
): Promise<void> {
  await page.goto(conferenceEditUrl(eventId), { waitUntil: "domcontentloaded" });
  const { conference } = selectors;

  const checkbox = page.locator(conference.isActive);
  const checked = await checkbox.isChecked().catch(() => false);
  if (checked !== input.isActive) {
    await checkbox.click();
  }

  await fillOrClear(page, conference.lpUrl, input.lpUrl);
  await fillOrClear(page, conference.cfpUrl, input.cfpUrl);
  await fillOrClear(page, conference.cfpStartAt, input.cfpStartAt);
  await fillOrClear(page, conference.cfpEndAt, input.cfpEndAt);
  await fillOrClear(page, conference.sponsorUrl, input.sponsorUrl);
  await fillOrClear(page, conference.sponsorStartAt, input.sponsorStartAt);
  await fillOrClear(page, conference.sponsorEndAt, input.sponsorEndAt);

  if (input.topics) {
    await page.locator(conference.topics).selectOption(input.topics.map((label) => ({ label })));
  }

  await page.locator(conference.submit).first().click();
  await page.waitForTimeout(400);
}
