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
