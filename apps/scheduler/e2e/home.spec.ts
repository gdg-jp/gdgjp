import { expect, test } from "@playwright/test";

test("create shows the server's validation messages and stays on the form", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Title/ }).fill("Invalid event");
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
    await page.getByRole("button", { name: `Remove time range for ${day}` }).click();
  }
  await expect(page.getByText("0 slots (60 min each)")).toBeVisible();
  const rejected = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/events/new"),
  );
  await page.getByRole("button", { name: "Create event" }).click();
  expect((await rejected).status()).toBe(400);
  await expect(page.getByRole("alert")).toContainText("Enable at least one day with a time range");
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: "Add time range for Mon" }).click();
  await expect(page.getByRole("combobox", { name: "Mon start time" })).toHaveText("09:00");
  await page.getByRole("combobox", { name: "Mon end time" }).click();
  await page.getByRole("option", { name: "09:30", exact: true }).click();
  await expect(page.getByText("0 slots (60 min each)")).toBeVisible();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("alert")).toContainText("shorter than the meeting length");
  await expect(page).toHaveURL(/\/$/);
});

for (const width of [390, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`create form supports ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem("gdg-apps-theme", value), theme);
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Schedule a meeting" })).toBeVisible();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await page
        .getByRole("textbox", { name: /^Title/ })
        .fill("日本語の長いタイトル：チームのスケジュールを相談する定例会議");
      await page.getByRole("combobox", { name: "Meeting length" }).click();
      await page.getByRole("option", { name: "30 min" }).click();
      await expect(page.getByText("30 slots (30 min each)")).toBeVisible();
      await page.getByRole("button", { name: "Add time range for Sat" }).click();
      await expect(page.getByLabel("Sat start time")).toBeVisible();
      await page.getByRole("button", { name: "Remove time range for Sat" }).click();
      await expect(page.getByLabel("Sat start time")).toHaveCount(0);
      await page.getByLabel("Theme", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Sign in" })).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/scheduler-${theme}-${width}.png`, fullPage: true });
    });
  }
}
