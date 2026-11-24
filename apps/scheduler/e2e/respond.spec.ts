import { type Page, expect, test } from "@playwright/test";

async function createEvent(page: Page, title: string, extraDays: string[] = []) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Title/ }).fill(title);
  for (const day of extraDays) {
    await page.getByRole("button", { name: `Add time range for ${day}` }).click();
  }
  await page.getByRole("button", { name: "Create event" }).click();
  await page.waitForURL(/\/e\/evt_[0-9A-Z]{26}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

function slot(page: Page, name: string) {
  return page.getByRole("checkbox", { name, exact: true });
}

async function toggleSlot(page: Page, name: string) {
  await page.locator("label", { has: slot(page, name) }).click();
}

test("a guest joins, sees who they are and updates availability without reloading", async ({
  page,
}) => {
  await createEvent(page, "Guest response check");
  await page.getByRole("textbox", { name: /^Your name/ }).fill("Playwright Guest");
  await toggleSlot(page, "Mon 19:00");
  await expect(slot(page, "Mon 19:00")).toBeChecked();
  await page.getByRole("button", { name: "Join", exact: true }).click();

  await expect(page.getByText("Participating as Playwright Guest")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Update your availability" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Your name/ })).toHaveCount(0);

  await toggleSlot(page, "Tue 19:00");
  await expect(slot(page, "Tue 19:00")).toBeChecked();
  const update = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes(".data"),
  );
  await page.getByRole("button", { name: "Update", exact: true }).click();
  expect((await update).status()).toBe(200);
  await expect(page.getByText("Availability updated")).toBeVisible();
  await expect(page.getByText("Participating as Playwright Guest")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Participating as Playwright Guest")).toBeVisible();
  await expect(slot(page, "Mon 19:00")).toBeChecked();
  await expect(slot(page, "Tue 19:00")).toBeChecked();
});

test("the event page fits a 390px viewport without horizontal page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createEvent(page, "Narrow viewport check", ["Sat", "Sun"]);
  for (const name of ["First narrow guest", "Second narrow guest"]) {
    await page.context().clearCookies();
    await page.reload();
    await page.getByRole("textbox", { name: /^Your name/ }).fill(name);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByRole("columnheader", { name })).toBeVisible();
  }
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
});
