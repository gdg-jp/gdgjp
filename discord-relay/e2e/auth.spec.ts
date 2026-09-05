import { expect, test } from "@playwright/test";

test("unauthenticated access to / redirects to /signin", async ({ page }) => {
  // Stop at the first hop: following it leads into /api/auth/signin, which needs
  // a reachable accounts IdP that this suite deliberately does not start.
  const res = await page.request.get("/", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("/signin");
});

test("a signed-in user with no chapter lands on /no-chapter", async ({ page }) => {
  await page.goto("/dev/login?as=stray&chapter=none&return_to=/");
  expect(page.url()).toContain("/no-chapter");
  await expect(
    page.getByRole("heading", { name: "GDG チャプターへの参加が必要です" }),
  ).toBeVisible();
});

test("dev login sets session and redirects to dashboard", async ({ page }) => {
  const res = await page.goto("/dev/login?as=e2e&chapter=1:tokyo&role=organizer&return_to=/");
  expect(res?.status()).toBe(200);
  expect(page.url()).not.toContain("/signin");
  await expect(page.getByText("Discord Relay Control Plane")).toBeVisible();
});
