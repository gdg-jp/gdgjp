import { expect, test } from "./fixtures";

test("anonymous public surfaces retain keyboard navigation and theme controls", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.getByRole("link", { name: /skip to content|本文へ移動/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in|サインイン/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /theme|配色/i })).toBeVisible();

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await context.close();
});

test("mobile navigation closes on Escape and returns focus to its trigger", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto("/");
  const trigger = page.getByRole("button", { name: /open sidebar|サイドバーを開く/i });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await context.close();
});

test("a signed-in member can view the about landing surface", async ({ memberPage }) => {
  await memberPage.goto("/about");
  await expect(memberPage.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    memberPage.getByRole("link", { name: /go to home|ホームへ戻る/i }).first(),
  ).toBeVisible();
});
