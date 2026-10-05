import { expect, test } from "@playwright/test";

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
      await page.getByLabel("Meeting length").selectOption("30");
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
