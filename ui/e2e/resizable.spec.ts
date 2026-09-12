import { expect, test } from "@playwright/test";

test("horizontal handle resizes panels in both directions", async ({ page }) => {
  await page.goto("/iframe.html?id=components-resizable--split-view&viewMode=story");

  const group = page.locator(".gdg-resizable-group");
  const panels = group.locator(".gdg-resizable-panel");
  const handle = group.locator(".gdg-resizable-handle");
  await expect(group).toBeVisible();

  const initialFirst = await panels.nth(0).boundingBox();
  const initialSecond = await panels.nth(1).boundingBox();
  const initialHandle = await handle.boundingBox();
  if (!initialFirst || !initialSecond || !initialHandle) {
    throw new Error("Resizable story did not render its panels and handle");
  }

  const centerY = initialHandle.y + initialHandle.height / 2;
  const centerX = initialHandle.x + initialHandle.width / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 40, centerY);
  await page.mouse.up();

  const expandedFirst = await panels.nth(0).boundingBox();
  const narrowedSecond = await panels.nth(1).boundingBox();
  if (!expandedFirst || !narrowedSecond) {
    throw new Error("Resizable story lost a panel after the first drag");
  }
  expect(expandedFirst.width).toBeGreaterThan(initialFirst.width + 20);
  expect(narrowedSecond.width).toBeLessThan(initialSecond.width - 20);

  const movedHandle = await handle.boundingBox();
  if (!movedHandle) throw new Error("Resizable story lost its handle after the first drag");
  const movedCenterX = movedHandle.x + movedHandle.width / 2;
  await page.mouse.move(movedCenterX, centerY);
  await page.mouse.down();
  await page.mouse.move(movedCenterX - 40, centerY);
  await page.mouse.up();

  const narrowedFirst = await panels.nth(0).boundingBox();
  const expandedSecond = await panels.nth(1).boundingBox();
  if (!narrowedFirst || !expandedSecond) {
    throw new Error("Resizable story lost a panel after the second drag");
  }
  expect(narrowedFirst.width).toBeLessThan(expandedFirst.width - 20);
  expect(expandedSecond.width).toBeGreaterThan(narrowedSecond.width + 20);
});
