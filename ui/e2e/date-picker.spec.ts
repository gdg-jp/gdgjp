import { expect, test } from "@playwright/test";

test("DatePicker selects all text and auto-formats numeric input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/iframe.html?id=components-datepicker--default&viewMode=story");

  const input = page.getByRole("textbox", { name: "日付" });
  await expect(input).toHaveValue("2026/09/12");
  await input.fill("2026/01/01");
  await input.press("Enter");
  await expect(input).toHaveValue("2026/01/01");
  await input.click();

  const calendar = page.locator(".gdg-date-picker-content");
  await expect(calendar).toBeVisible();
  await expect(input).toBeFocused();
  await input.click();
  await expect(calendar).toBeVisible();
  await expect(input).toBeFocused();
  const box = await calendar.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

  expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual(
    [0, 10],
  );

  await input.pressSequentially("2");
  await expect(input).toHaveValue("2");
  await input.pressSequentially("0264");
  await expect(input).toHaveValue("2026/04");
  await input.pressSequentially("10");
  await expect(input).toHaveValue("2026/04/10");

  await input.press("/");
  await expect(input).toHaveValue("2026/04/10");
  await input.press("Enter");
  await expect(input).toHaveValue("2026/04/10");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});

test("controlled empty and external replace sync input, selection, and month", async ({ page }) => {
  await page.goto("/iframe.html?id=components-datepicker--controlled-lifecycle&viewMode=story");
  const input = page.getByRole("textbox", { name: "Controlled date" });

  await page.getByRole("button", { name: "Clear value" }).click();
  await expect(input).toHaveValue("");
  await input.click();
  await expect(page.locator('.gdg-calendar-day[aria-pressed="true"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Replace value" }).click();
  await expect(input).toHaveValue("2026/11/03");
  await expect(page.locator('[data-date="2026-11-03"][aria-pressed="true"]')).toHaveCount(1);
});

test("controlled empty does not fall back to defaultValue", async ({ page }) => {
  await page.goto("/iframe.html?id=components-datepicker--controlled-empty&viewMode=story");
  const input = page.getByRole("textbox", { name: "空の期限" });
  await expect(input).toHaveValue("");
  await input.click();
  await expect(page.locator('.gdg-calendar-day[aria-pressed="true"]')).toHaveCount(0);
});

test("rejected controlled changes do not become committed display", async ({ page }) => {
  await page.goto("/iframe.html?id=components-datepicker--rejected-change&viewMode=story");
  const input = page.getByRole("textbox", { name: "Rejected date" });
  await input.click();
  await page.locator('[data-date="2026-09-01"]').click();
  await expect(input).toHaveValue("2026/09/12");
  await expect(page.locator('[data-date="2026-09-12"][aria-pressed="true"]')).toHaveCount(1);
});
