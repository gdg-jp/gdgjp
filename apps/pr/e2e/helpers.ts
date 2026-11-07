import { type Page, expect } from "@playwright/test";

/**
 * Add an event the way people do (a name only) and open its brief. The name is the slug, so the
 * URL the app makes from it is the slug itself.
 */
export async function createCampaign(page: Page, slug: string) {
  await page.goto("/events");
  await page.getByRole("button", { name: "イベントを追加" }).first().click();
  await page.getByLabel("イベント名").fill(slug);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}$`));
  await page.goto(`/c/${slug}/brief`);
}
