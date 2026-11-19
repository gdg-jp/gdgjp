import { expect, test } from "@playwright/test";

test("unauthenticated access to / redirects to /signin?return_to=%2F", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toContain("/signin?return_to=%2F");
});

test("signing in via /dev/login renders the empty home screen", async ({ page }) => {
  await page.goto("/dev/login?as=organizer1&chapter=1:tokyo:organizer&return_to=/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "GDG Japan Meet", level: 1 })).toBeVisible();
  await expect(page.getByText("まだ会議がありません")).toBeVisible();
});

test("users without a chapter see /no-chapter and chapter members redirect to /", async ({
  browser,
}) => {
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto("/dev/login?as=guest1&chapter=none&return_to=/no-chapter");
  await expect(guestPage).toHaveURL(/\/no-chapter$/);
  await expect(
    guestPage.getByRole("heading", { name: "GDG チャプターへの参加が必要です", level: 1 }),
  ).toBeVisible();
  await guestContext.close();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/dev/login?as=organizer1&chapter=1:tokyo:organizer&return_to=/no-chapter");
  await expect(memberPage).toHaveURL(/\/$/);
  await expect(memberPage.getByRole("heading", { name: "GDG Japan Meet", level: 1 })).toBeVisible();
  await memberContext.close();
});
