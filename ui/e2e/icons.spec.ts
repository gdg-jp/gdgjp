import { expect, test } from "@playwright/test";

const story = "/iframe.html?id=components-icons--default&viewMode=story";

test("icons expose the wrapper contract and animate on precise-pointer hover", async ({ page }) => {
  await page.goto(story);
  const icon = page.locator(".gdg-icons");
  const svg = icon.locator("svg");

  await expect(icon).toHaveAttribute("role", "img");
  await expect(icon).toHaveAttribute("aria-label", "お気に入り");
  await expect(svg).toHaveAttribute("width", "24");

  const before = await svg.getAttribute("style");
  await icon.hover();
  await expect.poll(async () => svg.getAttribute("style")).not.toBe(before);
});

test("icons do not start decorative hover motion when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(story);
  const icon = page.locator(".gdg-icons");
  const svg = icon.locator("svg");

  await icon.hover();
  await expect(svg).toHaveCSS("transform", "none");
});
