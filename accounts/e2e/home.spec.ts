import { expect, test } from "@playwright/test";

test("home page redirects unauthenticated users to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin\?return_to=%2Fdashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
});

test("Google sign in starts with a document navigation", async ({ page }) => {
  await page.route("**/oauth/google/start*", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.goto("/signin");

  const startRequest = page.waitForRequest((request) =>
    request.url().includes("/oauth/google/start"),
  );
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const request = await startRequest;

  expect(new URL(request.url()).pathname).toBe("/oauth/google/start");
  expect(request.resourceType()).toBe("document");
});
