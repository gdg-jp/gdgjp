import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  type Browser,
  type Page,
  request as apiRequest,
  expect,
  test,
} from "@playwright/test";
import {
  type SignedInUser,
  accountsDatabaseFromEnvironment,
  betterAuthSecret,
  createSession,
  createSignedInUser,
  deleteSignedInUser,
  execute,
  sqlString,
} from "./support/signed-in-user";

const ACCOUNTS_URL =
  process.env.E2E_ACCOUNTS_URL ?? `http://localhost:${process.env.CI ? 6173 : 5173}`;
const REDIRECT_URI = "http://127.0.0.1:6999/developer-client/callback";
const APP_NAME = "E2E Consent App";
const OWNER_NAME = "E2E Developer";

const database = accountsDatabaseFromEnvironment();
const clientId = `e2e-dev-${randomUUID()}`;
const clientSecret = randomBytes(32).toString("base64url");
let owner: SignedInUser;
let user: SignedInUser;

type Tokens = { access_token: string; refresh_token?: string };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const secret = betterAuthSecret();
  owner = createSignedInUser(database, ACCOUNTS_URL, secret);
  user = createSignedInUser(database, ACCOUNTS_URL, secret);
  const now = new Date().toISOString();
  execute(
    database,
    [
      `UPDATE "user" SET "name" = ${sqlString(OWNER_NAME)} WHERE "id" = ${sqlString(owner.id)};`,
      `INSERT INTO "oauthClient" ("id", "clientId", "clientSecret", "disabled", "skipConsent", "enableEndSession", "subjectType", "scopes", "userId", "createdAt", "updatedAt", "name", "redirectUris", "postLogoutRedirectUris", "tokenEndpointAuthMethod", "grantTypes", "responseTypes", "applicationType", "public", "type", "requirePKCE") VALUES (${sqlString(randomUUID())}, ${sqlString(clientId)}, ${sqlString(createHash("sha256").update(clientSecret).digest("base64url"))}, 0, 0, 1, 'public', '["openid","email","offline_access"]', ${sqlString(owner.id)}, ${sqlString(now)}, ${sqlString(now)}, ${sqlString(APP_NAME)}, ${sqlString(JSON.stringify([REDIRECT_URI]))}, '[]', 'client_secret_basic', '["authorization_code","refresh_token"]', '["code"]', 'web', 0, 'web', 1);`,
    ].join(" "),
  );
});

test.afterAll(() => {
  if (user) deleteSignedInUser(database, user);
  if (owner) deleteSignedInUser(database, owner);
});

async function signedInPage(browser: Browser, session: SignedInUser) {
  const context = await browser.newContext({ locale: "en-US" });
  const accounts = new URL(ACCOUNTS_URL);
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      domain: accounts.hostname,
      path: "/",
      httpOnly: true,
      secure: accounts.protocol === "https:",
      sameSite: "Lax",
    },
    {
      name: "accounts_onboarding_skip",
      value: Buffer.from(JSON.stringify("1")).toString("base64"),
      domain: accounts.hostname,
      path: "/",
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await page.route(`${REDIRECT_URI}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "callback reached" }),
  );
  return page;
}

function authorizeUrl(verifier: string) {
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "openid email offline_access",
    state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `${ACCOUNTS_URL}/api/auth/oauth2/authorize?${query}`;
}

async function expectConsentPage(page: Page) {
  await expect(page).toHaveURL(/\/oauth\/consent\?/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Authorize ${APP_NAME}?`);
  await expect(page.getByText(`Developed by ${OWNER_NAME}`)).toBeVisible();
  await expect(page.getByText("View your email address")).toBeVisible();
  await expect(page.getByText("Keep access after you sign out, until you remove it")).toBeVisible();
}

const basic = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;

function token(request: APIRequestContext, form: Record<string, string>) {
  return request.post(`${ACCOUNTS_URL}/api/auth/oauth2/token`, {
    headers: { Authorization: basic },
    form,
  });
}

function userinfo(request: APIRequestContext, accessToken: string) {
  return request.get(`${ACCOUNTS_URL}/api/auth/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

test("a developer client asks for consent and keeps its grant until the user removes it", async ({
  browser,
}) => {
  const verifier = randomBytes(32).toString("base64url");
  const page = await signedInPage(browser, user);
  const app = await apiRequest.newContext();

  await page.goto(authorizeUrl(verifier));
  await expectConsentPage(page);
  await page.getByRole("button", { name: "Allow and continue" }).click();
  await expect(page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
  const code = new URL(page.url()).searchParams.get("code");
  expect(code).toBeTruthy();

  const issued = await token(app, {
    grant_type: "authorization_code",
    code: code ?? "",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  expect(issued.status()).toBe(200);
  const first = (await issued.json()) as Tokens;
  expect(first.refresh_token).toBeTruthy();
  expect((await userinfo(app, first.access_token)).status()).toBe(200);

  await page.goto(`${ACCOUNTS_URL}/auth/signout`);
  expect(
    (await userinfo(app, first.access_token)).status(),
    "the library revokes an access token bound to the session that signed out",
  ).toBe(401);
  const refreshed = await token(app, {
    grant_type: "refresh_token",
    refresh_token: first.refresh_token ?? "",
  });
  expect(refreshed.status(), "the grant survives sign-out").toBe(200);
  const second = (await refreshed.json()) as Tokens;
  const me = await userinfo(app, second.access_token);
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { email?: string }).email).toBe(user.email);
  await page.context().close();

  const settings = await signedInPage(
    browser,
    createSession(database, ACCOUNTS_URL, betterAuthSecret(), user),
  );
  await settings.goto(`${ACCOUNTS_URL}/dashboard`);
  await settings.getByRole("link", { name: "Apps with access to your account" }).click();
  await expect(settings).toHaveURL(/\/settings\/connected-apps$/);
  await expect(settings.getByRole("heading", { level: 2, name: APP_NAME })).toBeVisible();
  await settings.getByRole("button", { name: "Remove access" }).click();
  await settings.getByRole("alertdialog").getByRole("button", { name: "Remove access" }).click();
  await expect(settings.getByText("No apps have access to your account.")).toBeVisible();

  const afterRemoval = await token(app, {
    grant_type: "refresh_token",
    refresh_token: second.refresh_token ?? "",
  });
  expect(afterRemoval.status()).toBe(400);
  expect(((await afterRemoval.json()) as { error?: string }).error).toBe("invalid_grant");
  expect((await userinfo(app, second.access_token)).status()).toBe(401);

  await settings.goto(authorizeUrl(randomBytes(32).toString("base64url")));
  await expectConsentPage(settings);
  await settings.getByRole("button", { name: "Cancel" }).click();
  await expect(settings).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
  expect(new URL(settings.url()).searchParams.get("error")).toBe("access_denied");
  await settings.context().close();
  await app.dispose();
});
