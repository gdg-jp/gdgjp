import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  DESTRUCTIVE_CONTROLS,
  type ExploreWorld,
  type PageMonitor,
  Ui,
} from "@gdgjp/ui-properties";
import type { Browser, BrowserContext } from "@playwright/test";
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

export const ACCOUNTS_URL = `http://localhost:${process.env.CI ? 6173 : 5173}`;
export const RP_URL = `http://localhost:${process.env.CI ? 6174 : 5174}`;
export const REDIRECT_URI = "http://127.0.0.1:6999/property-client/callback";
export const database = accountsDatabaseFromEnvironment();

export type Model = { signedIn: boolean; rp: boolean; consented: boolean };

export type AccountsWorld = ExploreWorld & {
  readonly context: BrowserContext;
  readonly user: SignedInUser;
  readonly owner: SignedInUser;
  readonly clientId: string;
  readonly appName: string;
  readonly model: Model;
};

export type Privileges = {
  admin: number;
  memberships: number;
  clients: number;
  consents: number;
  consentsForClient: number;
  sessions: number;
};

export function privileges(world: AccountsWorld): Privileges {
  const user = sqlString(world.user.id);
  const [row] = queryRows<Privileges>(
    database,
    `SELECT
      (SELECT "is_admin" FROM "user" WHERE "id" = ${user}) AS admin,
      (SELECT COUNT(*) FROM "memberships" WHERE "user_id" = ${user} AND "status" = 'active') AS memberships,
      (SELECT COUNT(*) FROM "oauthClient" WHERE "userId" = ${user}) AS clients,
      (SELECT COUNT(*) FROM "oauthConsent" WHERE "userId" = ${user}) AS consents,
      (SELECT COUNT(*) FROM "oauthConsent" WHERE "userId" = ${user} AND "clientId" = ${sqlString(world.clientId)}) AS consentsForClient,
      (SELECT COUNT(*) FROM "session" WHERE "userId" = ${user}) AS sessions;`,
  );
  if (!row) throw new Error("privilege query returned no row");
  return row;
}

export async function addSession(context: BrowserContext, session: SignedInUser): Promise<void> {
  const accounts = new URL(ACCOUNTS_URL);
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      domain: accounts.hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

export function newSession(world: AccountsWorld): SignedInUser {
  return createSession(database, ACCOUNTS_URL, betterAuthSecret(), world.user);
}

export function authorizeUrl(world: AccountsWorld): string {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: world.clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "openid email offline_access",
    state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `${ACCOUNTS_URL}/api/auth/oauth2/authorize?${query}`;
}

export function createWorld(browser: Browser) {
  return async (monitor: PageMonitor): Promise<AccountsWorld> => {
    const secret = betterAuthSecret();
    const owner = createSignedInUser(database, ACCOUNTS_URL, secret);
    const user = createSignedInUser(database, ACCOUNTS_URL, secret);
    const clientId = `e2e-property-${randomUUID()}`;
    const appName = `Property App ${clientId.slice(-6)}`;
    const now = new Date().toISOString();
    execute(
      database,
      `INSERT INTO "oauthClient" ("id", "clientId", "clientSecret", "disabled", "skipConsent", "enableEndSession", "subjectType", "scopes", "userId", "createdAt", "updatedAt", "name", "redirectUris", "postLogoutRedirectUris", "tokenEndpointAuthMethod", "grantTypes", "responseTypes", "applicationType", "public", "type", "requirePKCE") VALUES (${sqlString(randomUUID())}, ${sqlString(clientId)}, ${sqlString(createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url"))}, 0, 0, 1, 'public', '["openid","email","offline_access"]', ${sqlString(owner.id)}, ${sqlString(now)}, ${sqlString(now)}, ${sqlString(appName)}, ${sqlString(JSON.stringify([REDIRECT_URI]))}, '[]', 'client_secret_basic', '["authorization_code","refresh_token"]', '["code"]', 'web', 0, 'web', 1);`,
    );
    const context = await browser.newContext({ locale: "en-US" });
    context.setDefaultTimeout(15_000);
    await context.addCookies([
      {
        name: "accounts_onboarding_skip",
        value: Buffer.from(JSON.stringify("1")).toString("base64"),
        domain: new URL(ACCOUNTS_URL).hostname,
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await addSession(context, user);
    await context.route(`${REDIRECT_URI}**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>Callback</title><main><h1>Callback reached</h1><a href="${ACCOUNTS_URL}/dashboard">Back to Accounts</a></main>`,
      }),
    );
    monitor.watchContext(context);
    const page = await context.newPage();
    await page.goto(`${ACCOUNTS_URL}/dashboard`);
    return {
      ui: new Ui(monitor),
      monitor,
      page,
      context,
      user,
      owner,
      clientId,
      appName,
      start: `${ACCOUNTS_URL}/dashboard`,
      origins: [ACCOUNTS_URL],
      avoid: new RegExp(
        `${DESTRUCTIVE_CONTROLS.source}|google|join|request|参加|申請|rotate|create|new app|save|保存`,
        "i",
      ),
      model: { signedIn: true, rp: false, consented: false },
    };
  };
}

export async function destroyWorld(world: AccountsWorld): Promise<void> {
  try {
    await world.context.close();
  } finally {
    execute(database, `DELETE FROM "oauthClient" WHERE "clientId" = ${sqlString(world.clientId)};`);
    deleteSignedInUser(database, world.user);
    deleteSignedInUser(database, world.owner);
  }
}
