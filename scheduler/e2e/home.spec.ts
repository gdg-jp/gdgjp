import { expect, test } from "@playwright/test";

test("home page renders the create form", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Schedule a meeting" })).toBeVisible();
  await expect(page.getByLabel("Title")).toBeVisible();
});
