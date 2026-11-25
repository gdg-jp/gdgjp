import { expect, test } from "@playwright/test";
import { organizerLogin, seedXAccount } from "./local-d1";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("tag handles typed in the composer dialog survive closing it", async ({ page }) => {
  seedXAccount({
    id: "xacc-e2e-composer-31",
    chapterId: 31,
    xUserId: "9300000000000031",
    username: "e2e_composer_31",
  });
  await page.goto(organizerLogin("sns-e2e-composer", 31, "/schedule"));

  const openTags = page.getByRole("button", { name: "タグ付けするユーザー" });
  await expect(async () => {
    await page.locator('input[name="images"]').setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(openTags).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await openTags.click();
  const dialog = page.getByRole("dialog", { name: "タグ付けするユーザー" });
  await dialog.getByPlaceholder("@gdg_tokyo @gdg_osaka").fill("@gdg_tokyo @gdg_osaka");
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('#schedule-form input[name="tagHandles"]')).toHaveValue(
    "@gdg_tokyo @gdg_osaka",
  );
  await openTags.click();
  await expect(dialog.getByPlaceholder("@gdg_tokyo @gdg_osaka")).toHaveValue(
    "@gdg_tokyo @gdg_osaka",
  );
});
