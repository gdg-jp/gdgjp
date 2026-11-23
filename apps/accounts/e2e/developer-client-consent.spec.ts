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
  queryRows,
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

const INVALID_CODE = { error: "invalid_grant", error_description: "invalid code" };
const GRANT_REVOKED = {
  error: "invalid_grant",
  error_description: "grant revoked during token issuance",
};

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

function authorizeUrl(verifier: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "openid email offline_access",
    state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...extra,
  });
  return `${ACCOUNTS_URL}/api/auth/oauth2/authorize?${query}`;
}

async function approve(page: Page, verifier: string) {
  await page.goto(authorizeUrl(verifier));
  await expectConsentPage(page);
  await page.getByRole("button", { name: "Allow and continue" }).click();
  await expect(page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
  const code = new URL(page.url()).searchParams.get("code");
  expect(code).toBeTruthy();
  return code ?? "";
}

async function removeAccess(page: Page) {
  await page.goto(`${ACCOUNTS_URL}/settings/connected-apps`);
  await expect(page.getByRole("heading", { level: 2, name: APP_NAME })).toBeVisible();
  await page.getByRole("button", { name: "Remove access" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove access" }).click();
  await expect(page.getByText("No apps have access to your account.")).toBeVisible();
}

function exchange(request: APIRequestContext, code: string, verifier: string) {
  return token(request, {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
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

async function deleteConsentThroughBetterAuth(page: Page) {
  const consents = (await (
    await page.request.get(`${ACCOUNTS_URL}/api/auth/oauth2/get-consents`)
  ).json()) as { id: string; clientId: string }[];
  const consent = consents.find((row) => row.clientId === clientId);
  expect(consent).toBeTruthy();
  const deleted = await page.request.post(`${ACCOUNTS_URL}/api/auth/oauth2/delete-consent`, {
    headers: { Origin: ACCOUNTS_URL },
    data: { id: consent?.id },
  });
  expect(deleted.ok()).toBe(true);
}

function pendingCodeOfUser() {
  return `json_valid("value")
    AND json_extract("value", '$.type') = 'authorization_code'
    AND json_extract("value", '$.userId') = ${sqlString(user.id)}
    AND json_extract("value", '$.query.client_id') = ${sqlString(clientId)}`;
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

test("an authorization code issued before the user removes access cannot be exchanged", async ({
  browser,
}) => {
  const page = await signedInPage(
    browser,
    createSession(database, ACCOUNTS_URL, betterAuthSecret(), user),
  );
  const app = await apiRequest.newContext();

  const removedVerifier = randomBytes(32).toString("base64url");
  const removedCode = await approve(page, removedVerifier);
  await removeAccess(page);
  const afterRemoval = await exchange(app, removedCode, removedVerifier);
  expect(afterRemoval.status()).toBe(400);
  expect(((await afterRemoval.json()) as { error?: string }).error).toBe("invalid_grant");

  const deletedVerifier = randomBytes(32).toString("base64url");
  const deletedCode = await approve(page, deletedVerifier);
  await deleteConsentThroughBetterAuth(page);
  const afterDeletion = await exchange(app, deletedCode, deletedVerifier);
  expect(afterDeletion.status(), "the consent trigger deletes the pending code").toBe(400);
  expect(await afterDeletion.json()).toEqual(INVALID_CODE);

  const racingVerifier = randomBytes(32).toString("base64url");
  const racingCode = await approve(page, racingVerifier);
  execute(
    database,
    `UPDATE "oauthConsent" SET "userId" = ${sqlString(owner.id)}
     WHERE "userId" = ${sqlString(user.id)} AND "clientId" = ${sqlString(clientId)};`,
  );
  expect(
    queryRows(database, `SELECT 1 AS pending FROM "verification" WHERE ${pendingCodeOfUser()}`),
  ).toHaveLength(1);
  const withoutConsent = await exchange(app, racingCode, racingVerifier);
  expect(withoutConsent.status(), "the insert trigger refuses the token").toBe(400);
  expect(withoutConsent.headers()["cache-control"]).toBe("no-store");
  expect(await withoutConsent.json()).toEqual(GRANT_REVOKED);
  const retried = await exchange(app, racingCode, racingVerifier);
  expect(retried.status()).toBe(400);
  expect(await retried.json()).toEqual(INVALID_CODE);
  execute(
    database,
    `DELETE FROM "oauthConsent"
     WHERE "userId" = ${sqlString(owner.id)} AND "clientId" = ${sqlString(clientId)};`,
  );
  await page.goto(`${ACCOUNTS_URL}/settings/connected-apps`);
  await expect(page.getByText("No apps have access to your account.")).toBeVisible();

  await page.context().close();
  await app.dispose();
});

test("Better Auth's own consent deletion revokes the tokens already issued", async ({
  browser,
}) => {
  const page = await signedInPage(
    browser,
    createSession(database, ACCOUNTS_URL, betterAuthSecret(), user),
  );
  const app = await apiRequest.newContext();
  const verifier = randomBytes(32).toString("base64url");
  const issued = await exchange(app, await approve(page, verifier), verifier);
  expect(issued.status()).toBe(200);
  const tokens = (await issued.json()) as Tokens;
  expect((await userinfo(app, tokens.access_token)).status()).toBe(200);

  await deleteConsentThroughBetterAuth(page);

  const me = await userinfo(app, tokens.access_token);
  expect(me.status()).toBe(401);
  expect(((await me.json()) as { error?: string }).error).toBe("invalid_token");
  const refreshed = await token(app, {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token ?? "",
  });
  expect(refreshed.status()).toBe(400);
  expect(((await refreshed.json()) as { error?: string }).error).toBe("invalid_grant");

  await page.context().close();
  await app.dispose();
});

test("a developer client's JWT access token does not work at Accounts", async ({ browser }) => {
  const page = await signedInPage(
    browser,
    createSession(database, ACCOUNTS_URL, betterAuthSecret(), user),
  );
  const app = await apiRequest.newContext();
  const userinfoUrl = `${ACCOUNTS_URL}/api/auth/oauth2/userinfo`;
  const verifier = randomBytes(32).toString("base64url");
  const code = await approve(page, verifier);
  execute(
    database,
    `UPDATE "verification"
     SET "value" = json_set("value", '$.resource', json(${sqlString(JSON.stringify([userinfoUrl]))}),
                            '$.query.scope', 'openid email')
     WHERE ${pendingCodeOfUser()};`,
  );

  const issued = await exchange(app, code, verifier);
  expect(issued.status(), "a stored resource is inherited without a resource parameter").toBe(200);
  const { access_token: accessToken } = (await issued.json()) as Tokens;
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { azp?: string; aud?: string };
  expect(payload).toMatchObject({ azp: clientId, aud: userinfoUrl });

  for (const path of ["/api/auth/oauth2/userinfo", "/userinfo"]) {
    const refused = await app.get(`${ACCOUNTS_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(refused.status(), path).toBe(401);
    expect(refused.headers()["www-authenticate"], path).toBe(
      'Bearer error="invalid_token", error_description="Invalid access token"',
    );
    expect(await refused.json(), path).toEqual({
      error: "invalid_token",
      error_description: "Invalid access token",
    });
  }
  const introspected = await app.post(`${ACCOUNTS_URL}/api/auth/oauth2/introspect`, {
    headers: { Authorization: basic },
    form: { token: accessToken },
  });
  expect(introspected.status()).toBe(200);
  expect(await introspected.json()).toEqual({ active: false });

  await page.context().close();
  await app.dispose();
});

test("a developer client cannot obtain a token bound to a resource", async ({ browser }) => {
  const page = await signedInPage(
    browser,
    createSession(database, ACCOUNTS_URL, betterAuthSecret(), user),
  );
  const app = await apiRequest.newContext();
  const state = randomUUID();

  for (const path of ["/api/auth/oauth2/authorize", "/authorize"]) {
    const url = new URL(
      authorizeUrl(randomBytes(32).toString("base64url"), {
        resource: `${ACCOUNTS_URL}/api/auth/oauth2/userinfo`,
        state,
      }),
    );
    url.pathname = path;
    const refused = await page.request.get(url.toString(), { maxRedirects: 0 });
    expect(refused.status(), path).toBe(302);
    const location = new URL(refused.headers().location ?? "");
    expect(`${location.origin}${location.pathname}`, path).toBe(REDIRECT_URI);
    const redirected = location.searchParams;
    expect(redirected.get("error"), path).toBe("invalid_target");
    expect(redirected.get("state"), path).toBe(state);
    expect(redirected.get("code"), path).toBeNull();
  }

  for (const endpoint of ["/api/auth/oauth2/token", "/oauth/token"]) {
    const refused = await app.post(`${ACCOUNTS_URL}${endpoint}`, {
      headers: { Authorization: basic },
      form: {
        grant_type: "refresh_token",
        refresh_token: "unused",
        resource: `${ACCOUNTS_URL}/api/auth/oauth2/userinfo`,
      },
    });
    expect(refused.status(), endpoint).toBe(400);
    expect(((await refused.json()) as { error?: string }).error, endpoint).toBe("invalid_target");
  }

  await page.context().close();
  await app.dispose();
});
