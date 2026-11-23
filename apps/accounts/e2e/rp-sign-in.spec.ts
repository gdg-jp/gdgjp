import { expect, test } from "@playwright/test";
import {
  type SignedInUser,
  accountsDatabaseFromEnvironment,
  betterAuthSecret,
  createSignedInUser,
  deleteSignedInUser,
} from "./support/signed-in-user";

const ACCOUNTS_URL =
  process.env.E2E_ACCOUNTS_URL ?? `http://localhost:${process.env.CI ? 6173 : 5173}`;
const RELYING_PARTIES = (
  process.env.E2E_RP_URLS ?? `http://localhost:${process.env.CI ? 6174 : 5174}`
)
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const database = accountsDatabaseFromEnvironment();
let user: SignedInUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  user = createSignedInUser(database, ACCOUNTS_URL, betterAuthSecret());
});

test.afterAll(() => {
  if (user) deleteSignedInUser(database, user);
});

for (const relyingParty of RELYING_PARTIES) {
  test(`an Accounts session signs in to ${relyingParty} through the OIDC code flow`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const accounts = new URL(ACCOUNTS_URL);
    await context.addCookies([
      {
        name: user.cookieName,
        value: user.cookieValue,
        domain: accounts.hostname,
        path: "/",
        httpOnly: true,
        secure: accounts.protocol === "https:",
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    const callbacks: { status: number; url: string }[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/auth/callback"))
        callbacks.push({ status: response.status(), url: response.url() });
    });

    await page.goto(`${relyingParty}/api/auth/signin`, { waitUntil: "domcontentloaded" });

    expect(callbacks, "the RP callback must run exactly once").toHaveLength(1);
    expect(new URL(callbacks[0].url).origin).toBe(relyingParty);
    expect(callbacks[0].status, "the RP callback must redirect after the token exchange").toBe(302);
    expect(new URL(page.url()).origin).toBe(relyingParty);
    await expect(page.locator("body")).not.toContainText("Authentication failed");

    const me = await context.request.get(`${relyingParty}/api/auth/me`);
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { user: { email?: string } | null };
    expect(body.user?.email).toBe(user.email);
    await context.close();
  });
}
