import { expect, test } from "@playwright/test";

const story = "/iframe.html?id=components-collapsible--default&viewMode=story";

test("collapsible animates pointer open and close while keeping closed content inert", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto(story);

  const trigger = page.getByRole("button", { name: "詳細を表示" });
  const content = page.locator(".gdg-collapsible-content");
  await expect(content).toHaveAttribute("data-state", "open");
  const openHeight = await content.evaluate((element) => element.getBoundingClientRect().height);

  await trigger.click();
  await expect(content).toHaveAttribute("data-state", "closed");
  await expect(content).toHaveCSS("transition-duration", "0.2s, 0.2s");
  await page.waitForTimeout(50);
  const closingHeight = await content.evaluate((element) => element.getBoundingClientRect().height);
  expect(closingHeight).toBeGreaterThan(0);
  expect(closingHeight).toBeLessThan(openHeight);
  await page.waitForTimeout(200);
  await expect(content).toHaveCSS("height", "0px");
  await expect(content).toHaveCSS("opacity", "0");
  expect(await content.evaluate((element) => element.inert)).toBe(true);

  await trigger.click();
  await expect(content).toHaveAttribute("data-state", "open");
  await page.waitForTimeout(50);
  const openingHeight = await content.evaluate((element) => element.getBoundingClientRect().height);
  expect(openingHeight).toBeGreaterThan(0);
  expect(openingHeight).toBeLessThan(openHeight);
  expect(await content.evaluate((element) => element.inert)).toBe(false);
});

test("collapsible skips movement for keyboard and reduced-motion changes", async ({ page }) => {
  await page.goto(story);
  const trigger = page.getByRole("button", { name: "詳細を表示" });
  const content = page.locator(".gdg-collapsible-content");

  await trigger.focus();
  await page.keyboard.press("Space");
  await expect(content).toHaveAttribute("data-state", "closed");
  await expect(content).toHaveCSS("transition-duration", "0s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(content).toHaveAttribute("data-state", "open");
  await expect(content).toHaveCSS("transition-duration", "0s");
  await trigger.click();
  await expect(content).toHaveCSS("height", "0px");
});
