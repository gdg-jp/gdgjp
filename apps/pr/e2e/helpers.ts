import { type Page, expect } from "@playwright/test";

export async function createCampaign(page: Page, slug: string) {
  await page.goto("/events");
  await page.getByRole("button", { name: "イベントを追加" }).first().click();
  await page.getByLabel("イベント名").fill(slug);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}$`));
  await page.goto(`/c/${slug}/brief`);
}
