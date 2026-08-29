import { expect, test } from "@playwright/test";

/**
 * Each test seeds its own event so its desk is the only one in the board's
 * Durable Object — DO storage isn't reset between runs the way D1 is, so a
 * shared slug would accumulate desks across test invocations.
 */
async function seed(request: import("@playwright/test").APIRequestContext, slug: string) {
  const res = await request.get(`/dev/seed?slug=${slug}&title=E2E%20Edit&chapter=1:dev-chapter`);
  expect(res.ok()).toBeTruthy();
}

/** Reads the desk's current on-screen rotation (degrees) from its CSS transform. */
async function readRotation(desk: import("@playwright/test").Locator): Promise<number> {
  return desk.evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  });
}

test("resize handle grows the desk by the pointer delta without moving it", async ({
  page,
  request,
}) => {
  const slug = `e2e-edit-resize-${Date.now()}`;
  await seed(request, slug);
  await page.goto(`/dev/login?as=owner&chapter=1:dev-chapter&return_to=/${slug}/edit`);
  await page.getByRole("button", { name: "机を追加" }).click();

  const handle = page.getByRole("button", { name: "サイズ変更" });
  await expect(handle).toBeVisible();
  const desk = handle.locator("xpath=..");

  const before = await desk.boundingBox();
  if (!before) throw new Error("desk not found");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("handle not found");
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY + 60, { steps: 10 });

  // Mid-gesture (before pointerup): size should track the raw pointer delta
  // (regression: used to grow ~2x) and the desk must not have translated.
  const mid = await desk.boundingBox();
  if (!mid) throw new Error("desk not found mid-gesture");
  expect(mid.width - before.width).toBeGreaterThan(60);
  expect(mid.width - before.width).toBeLessThan(140);
  expect(Math.abs(mid.x - before.x)).toBeLessThan(5);
  expect(Math.abs(mid.y - before.y)).toBeLessThan(5);

  // Wait for the commit POST to land before reloading, since fetcher.submit
  // is fired-and-forgotten from the pointerup handler.
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes(`/${slug}/edit`),
    ),
    page.mouse.up(),
  ]);

  // The resized width should survive a reload (persisted to the DO).
  const committedWidth = mid.width;
  await page.reload();
  const persisted = await handle.locator("xpath=..").boundingBox();
  if (!persisted) throw new Error("desk not found after reload");
  expect(Math.abs(persisted.width - committedWidth)).toBeLessThan(5);
});

test("rotate handle tracks the cursor from grab without jumping or moving the desk", async ({
  page,
  request,
}) => {
  const slug = `e2e-edit-rotate-${Date.now()}`;
  await seed(request, slug);
  await page.goto(`/dev/login?as=owner&chapter=1:dev-chapter&return_to=/${slug}/edit`);
  await page.getByRole("button", { name: "机を追加" }).click();

  const handle = page.getByRole("button", { name: "回転" });
  await expect(handle).toBeVisible();
  const desk = handle.locator("xpath=..");

  const before = await desk.boundingBox();
  if (!before) throw new Error("desk not found");
  expect(await readRotation(desk)).toBeCloseTo(0, 0);

  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("handle not found");
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // A small nudge near the handle's starting angle should not produce a
  // large jump (regression: used to snap to ~-110deg immediately).
  await page.mouse.move(startX + 8, startY + 4, { steps: 5 });

  const rotationDuringGesture = await readRotation(desk);
  expect(Math.abs(rotationDuringGesture)).toBeLessThan(30);

  // Compare centers, not top-left corners: rotating in place legitimately
  // changes the axis-aligned bounding box's edges even though the desk's
  // own center (the CSS transform-origin) hasn't moved.
  const mid = await desk.boundingBox();
  if (!mid) throw new Error("desk not found mid-gesture");
  const beforeCenter = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  const midCenter = { x: mid.x + mid.width / 2, y: mid.y + mid.height / 2 };
  expect(Math.abs(midCenter.x - beforeCenter.x)).toBeLessThan(5);
  expect(Math.abs(midCenter.y - beforeCenter.y)).toBeLessThan(5);

  await page.mouse.up();
});
