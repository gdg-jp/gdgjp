import { expect, test } from "@playwright/test";

test("slider story renders its track and responds to keyboard input", async ({ page }) => {
  await page.goto("/iframe.html?id=components-slider--volume&viewMode=story");

  const slider = page.locator(".gdg-slider");
  const thumb = slider.getByRole("slider", { name: "音量" });
  await expect(slider).toBeVisible();
  await expect(slider).toHaveCSS("width", "320px");
  await expect(slider).toHaveCSS("height", "24px");
  await expect(slider.locator(".gdg-slider-track")).toHaveCSS("height", "8px");

  await thumb.focus();
  await expect(thumb).toBeFocused();
  await expect(thumb).toHaveAttribute("aria-valuenow", "64");
  await page.keyboard.press("ArrowRight");
  await expect(thumb).toHaveAttribute("aria-valuenow", "65");

  await page.goto("/iframe.html?id=components-slider--range&viewMode=story");
  await expect(page.getByRole("slider", { name: "価格帯の最小値" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "価格帯の最大値" })).toBeVisible();
});
