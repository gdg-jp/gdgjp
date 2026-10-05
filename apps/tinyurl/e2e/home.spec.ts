import { type Page, expect, test } from "@playwright/test";

const ACCOUNTS_URL = `http://localhost:${process.env.CI ? 6173 : 5173}`;
const TINYURL_URL = `http://localhost:${process.env.CI ? 6174 : 5174}`;

// An unauthenticated request is forwarded through TinyURL's relying-party
// handler to the Accounts sign-in page. Better Auth carries the OIDC
// authorization request directly in the sign-in query string.
async function expectAccountsSignIn(page: Page) {
  await expect(page).toHaveURL((url) => url.origin === ACCOUNTS_URL && url.pathname === "/signin");

  const url = new URL(page.url());
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("client_id")).toBe("tinyurl");
  expect(url.searchParams.get("redirect_uri")).toBe(`${TINYURL_URL}/api/auth/callback/gdgjp`);
  expect(url.searchParams.get("scope")).toContain("openid");
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(url.searchParams.get("nonce")).toBeTruthy();
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
}

test("home page redirects unauthenticated users to the accounts IdP sign-in", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectAccountsSignIn(page);
});

test("campaigns redirects unauthenticated users to the accounts IdP sign-in", async ({ page }) => {
  await page.goto("/campaigns", { waitUntil: "domcontentloaded" });
  await expectAccountsSignIn(page);
});
