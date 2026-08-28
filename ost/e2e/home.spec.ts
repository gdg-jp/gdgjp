import { expect, test } from "@playwright/test";

test("participant can submit a topic and see confirmation", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "話したいテーマは？" })).toBeVisible();

  await page.getByRole("textbox").fill(`e2e topic ${Date.now()}`);
  await page.getByRole("button", { name: "送信する" }).click();

  await expect(page.getByRole("heading", { name: "送信しました 🎉" })).toBeVisible();
});

test("empty submission is rejected by the server", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Bypass the client-side `required` guard to exercise the action's validation.
  await page.evaluate(() => {
    document
      .querySelector<HTMLTextAreaElement>('textarea[name="text"]')
      ?.removeAttribute("required");
  });
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.getByRole("alert")).toContainText("テーマを入力してください");
});
