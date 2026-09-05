import { expect, test } from "@playwright/test";

test("unauthenticated access to / redirects to /signin", async ({ page }) => {
  await page.goto("/");
  expect(page.url()).toContain("/signin");
});

test("/no-chapter page renders without error", async ({ page }) => {
  const res = await page.goto("/no-chapter");
  expect(res?.status()).toBe(200);
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
