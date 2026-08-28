import { expect, test } from "@playwright/test";

const SLUG = "e2e";

test.beforeEach(async ({ request }) => {
  const res = await request.get(`/dev/seed?slug=${SLUG}&title=E2E%20Event`);
  expect(res.ok()).toBeTruthy();
});

test("participant can submit a topic and see confirmation", async ({ page }) => {
  await page.goto(`/${SLUG}`);
  await expect(page.getByRole("heading", { name: "話したいテーマは？" })).toBeVisible();
  await page.getByRole("textbox").fill(`e2e topic ${Date.now()}`);
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByRole("heading", { name: "送信しました 🎉" })).toBeVisible();
});

test("empty submission is rejected by the server", async ({ page }) => {
  await page.goto(`/${SLUG}`);
  await page.evaluate(() => {
    document.querySelector('textarea[name="text"]')?.removeAttribute("required");
  });
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByRole("alert")).toContainText("テーマを入力してください");
});

test("unknown event slug 404s", async ({ page }) => {
  const res = await page.goto("/definitely-not-an-event");
  expect(res?.status()).toBe(404);
});
