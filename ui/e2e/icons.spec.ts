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

test("static icons use the same wrapper, props, and accessible-name contract", async ({ page }) => {
  await page.goto("/iframe.html?id=components-icons--static&viewMode=story");
  const icon = page.locator(".gdg-icons");
  const svg = icon.locator("svg");

  await expect(icon).toHaveAttribute("role", "img");
  await expect(icon).toHaveAttribute("aria-label", "お気に入り");
  await expect(icon).toHaveAttribute("data-testid", "static-icon");
  await expect(icon).toHaveCSS("stroke-width", "1.5px");
  await expect(svg).toHaveAttribute("stroke-width", "1.5");
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  await expect(svg).toHaveAttribute("focusable", "false");

  const before = await svg.getAttribute("style");
  await icon.hover();
  expect(await svg.getAttribute("style")).toBe(before);
});

test("the Wiki icon inventory renders through the shared wrapper", async ({ page }) => {
  await page.goto("/iframe.html?id=components-icons--wiki-catalog&viewMode=story");
  const icons = page.locator(".gdg-icons");
  await expect(icons).toHaveCount(64);
  await expect(icons.locator("svg")).toHaveCount(64);
  await expect(icons.locator("svg").first()).toHaveAttribute("aria-hidden", "true");
});
