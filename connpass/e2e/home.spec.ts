import { expect, test } from "@playwright/test";

test("home page describes the machine API", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "connpass.gdgs.jp" })).toBeVisible();
  await expect(page.getByText("Bearer")).toBeVisible();
});
