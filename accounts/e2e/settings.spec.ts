import { expect, test } from "@playwright/test";

test("settings page redirects unauthenticated users to sign in", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/signin\?return_to=%2Fsettings/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
});
