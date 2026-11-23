import { type Browser, expect, test } from "@playwright/test";
import {
  type SignedInUser,
  accountsDatabaseFromEnvironment,
  betterAuthSecret,
  createSession,
  createSignedInUser,
  deleteSession,
  deleteSignedInUser,
  findExistingMember,
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
let newUser: SignedInUser;
let returningUser: SignedInUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  newUser = createSignedInUser(database, ACCOUNTS_URL, betterAuthSecret());
});

test.afterAll(() => {
  if (returningUser && returningUser.id !== newUser?.id) deleteSession(database, returningUser);
  if (newUser) deleteSignedInUser(database, newUser);
});

async function signInThroughRelyingParty(
  browser: Browser,
  relyingParty: string,
  user: SignedInUser,
) {
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
}

for (const relyingParty of RELYING_PARTIES) {
  test(`an Accounts session signs in to ${relyingParty} through the OIDC code flow`, async ({
    browser,
  }) => {
    await signInThroughRelyingParty(browser, relyingParty, newUser);
  });
}

for (const relyingParty of RELYING_PARTIES) {
  test(`a returning member signs in to ${relyingParty} again`, async ({ browser }) => {
    if (!returningUser) {
      const member = database.kind === "remote" ? findExistingMember(database) : newUser;
      if (!member)
        throw new Error("The deployed Accounts database has no active member to sign in");
      returningUser = createSession(database, ACCOUNTS_URL, betterAuthSecret(), member);
    }
    await signInThroughRelyingParty(browser, relyingParty, returningUser);
  });
}
