import { expect, test } from "@playwright/test";

// Post-PR-2 SSO flow: an unauthenticated visit to /links bounces through
//   tinyurl/             (302 to /signin)
//   → tinyurl/signin     (302 to /api/auth/signin?return_to=/links)
//   → tinyurl/api/auth/signin (openid-client; 302 to IdP /authorize?...)
//   → accounts/authorize (no IdP session; 302 to /signin?return_to=/authorize?…)
//   → accounts/signin    (renders the Google sign-in page)
// The browser follows all of these; domcontentloaded fires on the IdP signin
// page, so "/links" is no longer in the final URL — it's encoded inside the
// /authorize URL the IdP carries as its own return_to.
test("home page redirects unauthenticated users to the accounts IdP sign-in", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/^http:\/\/localhost:5173\/signin\?return_to=/);
});

test("campaigns redirects unauthenticated users to the accounts IdP sign-in", async ({ page }) => {
  await page.goto("/campaigns", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/^http:\/\/localhost:5173\/signin\?return_to=/);
});
