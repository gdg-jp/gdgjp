import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/i18n/i18n.server", () => ({ i18n: {} }));

import { getAuth, invalidateAuthCache, runAuthHandler } from "~/features/auth/auth.server";
import { removeConnectedApp } from "~/features/oauth/connected-apps.server";
import {
  grantRemovedDuringIssuance,
  inactiveIntrospection,
  introspectsDeveloperClientJwt,
  refuseDeveloperClientUserInfo,
} from "~/features/oauth/developer-client-tokens.server";
import { revokeUserSessions } from "~/features/users/user-admin.server";

const ORIGIN = "https://accounts.example";
const USERINFO = `${ORIGIN}/api/auth/oauth2/userinfo`;
const INTROSPECT = `${ORIGIN}/api/auth/oauth2/introspect`;
const TOKEN = `${ORIGIN}/api/auth/oauth2/token`;
const DEV_REDIRECT = "https://dev.example/callback";
const FP_REDIRECT = "https://wiki.example/callback";
const FORM = "application/x-www-form-urlencoded";
const FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();
const NOW = () => new Date().toISOString();
const INVALID_TOKEN_CHALLENGE =
  'Bearer error="invalid_token", error_description="Invalid access token"';

type Statement = { sql: string; params: SQLInputValue[] };

const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

function migrated() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).sort()) {
    raw.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return raw;
}

function testD1(raw: DatabaseSync) {
  let interruption: { pattern: RegExp; run: () => Promise<unknown> } | null = null;
  const bindable = (value: unknown): SQLInputValue => {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    return value as SQLInputValue;
  };
  const execute = ({ sql, params }: Statement) => {
    const prepared = raw.prepare(sql);
    if (prepared.columns().length > 0) {
      const results = prepared.all(...params);
      return { results, meta: { changes: results.length, last_row_id: null } };
    }
    const { changes, lastInsertRowid } = prepared.run(...params);
    return {
      results: [],
      meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) },
    };
  };
  const statement = (sql: string, params: SQLInputValue[] = []) => {
    const all = async () => {
      if (interruption?.pattern.test(sql)) {
        const { run } = interruption;
        interruption = null;
        await run();
      }
      return execute({ sql, params });
    };
    return {
      sql,
      params,
      bind: (...next: unknown[]) => statement(sql, next.map(bindable)),
      all,
      run: all,
      first: async () => (await all()).results[0] ?? null,
    };
  };
  const db = {
    prepare: (sql: string) => statement(sql),
    exec: async (sql: string) => raw.exec(sql),
    async batch(statements: Statement[]) {
      raw.exec("BEGIN");
      try {
        const results = statements.map(execute);
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    db: db as unknown as D1Database,
    interruptBefore(pattern: RegExp, run: () => Promise<unknown>) {
      interruption = { pattern, run };
    },
  };
}

function seed(raw: DatabaseSync) {
  raw.exec(`INSERT INTO "user" (id, name, email) VALUES
    ('owner', 'Owner', 'owner@example.com'), ('user-1', 'User One', 'one@example.com')`);
  raw
    .prepare(`INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
      VALUES ('s1', ?, 'session-token', ?, ?, 'user-1')`)
    .run(FUTURE(), NOW(), NOW());
  const client = raw.prepare(`INSERT INTO "oauthClient" ("id", "clientId", "clientSecret",
      "disabled", "skipConsent", "enableEndSession", "subjectType", "scopes", "userId", "createdAt",
      "updatedAt", "name", "redirectUris", "postLogoutRedirectUris", "tokenEndpointAuthMethod",
      "grantTypes", "responseTypes", "applicationType", "public", "type", "requirePKCE")
    VALUES (?, ?, ?, 0, ?, 1, 'public', '["openid","email","offline_access"]', ?, ?, ?, ?, ?, '[]',
      'client_secret_basic', '["authorization_code","refresh_token"]', '["code"]', 'web', 0,
      'web', 1)`);
  client.run(
    "c1",
    "dev-app",
    hash("dev?secret"),
    0,
    "owner",
    NOW(),
    NOW(),
    "Dev",
    `["${DEV_REDIRECT}"]`,
  );
  client.run(
    "c2",
    "fp-wiki",
    hash("fp-secret"),
    1,
    null,
    NOW(),
    NOW(),
    "Wiki",
    `["${FP_REDIRECT}"]`,
  );
}

function consent(raw: DatabaseSync, id = "consent") {
  raw
    .prepare(`INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
      VALUES (?, 'dev-app', 'user-1', '["openid","email","offline_access"]', ?, ?)`)
    .run(id, NOW(), NOW());
}

function refreshToken(raw: DatabaseSync, token: string) {
  raw
    .prepare(`INSERT INTO "oauthRefreshToken"
      (id, token, "clientId", "sessionId", "userId", "expiresAt", "createdAt", scopes)
      VALUES (?, ?, 'dev-app', NULL, 'user-1', ?, ?, '["openid","email","offline_access"]')`)
    .run(randomUUID(), hash(token), FUTURE(), NOW());
}

function authorizationCode(
  raw: DatabaseSync,
  input: { code: string; clientId: string; redirectUri: string; scope: string; resource?: string },
) {
  const value = {
    type: "authorization_code",
    query: {
      response_type: "code",
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      scope: input.scope,
      code_challenge: hash(`verifier-${input.code}`),
      code_challenge_method: "S256",
    },
    userId: "user-1",
    sessionId: "s1",
    authTime: Date.now(),
    ...(input.resource ? { resource: [input.resource] } : {}),
  };
  raw
    .prepare(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), hash(input.code), JSON.stringify(value), FUTURE(), NOW(), NOW());
}

function setup() {
  const raw = migrated();
  seed(raw);
  const d1 = testD1(raw);
  const env = {
    APP_URL: ORIGIN,
    BETTER_AUTH_SECRET: "better-auth-test-secret-that-is-long-enough",
    GOOGLE_CLIENT_ID: "google",
    GOOGLE_CLIENT_SECRET: "google-secret",
    DB: d1.db,
  } as unknown as Env;
  return { raw, env, ...d1 };
}

function basicFor(clientId: string, secret: string, encoding: "base64" | "base64url" = "base64") {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString(encoding)}`;
}

const DEV_BASIC = basicFor("dev-app", "dev?secret");
const FP_BASIC = basicFor("fp-wiki", "fp-secret");

function form(url: string, body: Record<string, string>, authorization?: string) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": FORM, ...(authorization ? { Authorization: authorization } : {}) },
    body: new URLSearchParams(body),
  });
}

function refresh(token: string) {
  return form(TOKEN, { grant_type: "refresh_token", refresh_token: token }, DEV_BASIC);
}

function exchange(code: string, redirectUri: string, authorization: string, extra = {}) {
  return form(
    TOKEN,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: `verifier-${code}`,
      ...extra,
    },
    authorization,
  );
}

function userinfo(token: string) {
  return new Request(USERINFO, { headers: { Authorization: `Bearer ${token}` } });
}

function introspect(token: string, authorization?: string) {
  return form(INTROSPECT, { token }, authorization);
}

function tokenIds(raw: DatabaseSync) {
  const ids = (table: string) => raw.prepare(`SELECT id FROM "${table}"`).all().length;
  return { access: ids("oauthAccessToken"), refresh: ids("oauthRefreshToken") };
}

async function expectGrantRevoked(response: Response) {
  expect(response.status).toBe(400);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  await expect(response.json()).resolves.toEqual({
    error: "invalid_grant",
    error_description: "grant revoked during token issuance",
  });
}

async function expectInvalidToken(response: Response) {
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(INVALID_TOKEN_CHALLENGE);
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("WWW-Authenticate");
  await expect(response.json()).resolves.toEqual({
    error: "invalid_token",
    error_description: "Invalid access token",
  });
}

async function developerJwt(env: Env, raw: DatabaseSync, code = "dev-code") {
  authorizationCode(raw, {
    code,
    clientId: "dev-app",
    redirectUri: DEV_REDIRECT,
    scope: "openid email",
    resource: USERINFO,
  });
  const response = await runAuthHandler(env, exchange(code, DEV_REDIRECT, DEV_BASIC));
  expect(response.status).toBe(200);
  const { access_token: accessToken } = (await response.json()) as { access_token: string };
  return accessToken;
}

describe("developer client tokens with Better Auth", () => {
  beforeEach(() => {
    invalidateAuthCache();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    invalidateAuthCache();
    vi.restoreAllMocks();
  });

  it("rotates a consented developer refresh token", async () => {
    const { raw, env } = setup();
    consent(raw);
    refreshToken(raw, "rt");

    const response = await runAuthHandler(env, refresh("rt"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });
    expect(tokenIds(raw)).toEqual({ access: 1, refresh: 2 });
  });

  it.each([
    ["the user removes the app", (db: D1Database) => removeConnectedApp(db, "user-1", "dev-app")],
    [
      "an administrator revokes the user's sessions",
      (db: D1Database) => revokeUserSessions(db, { actorId: "admin", targetId: "user-1" }),
    ],
  ])("answers invalid_grant when %s during a refresh rotation", async (_name, revoke) => {
    const { raw, env, db, interruptBefore } = setup();
    consent(raw);
    refreshToken(raw, "rt");
    interruptBefore(/^insert into "oauthRefreshToken"/i, () => revoke(db));

    await expectGrantRevoked(await runAuthHandler(env, refresh("rt")));

    expect(tokenIds(raw)).toEqual({ access: 0, refresh: 0 });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("answers invalid_grant when consent is gone at a code exchange's token insert", async () => {
    const { raw, env, interruptBefore } = setup();
    consent(raw);
    authorizationCode(raw, {
      code: "code",
      clientId: "dev-app",
      redirectUri: DEV_REDIRECT,
      scope: "openid offline_access",
    });
    interruptBefore(/^insert into "oauthRefreshToken"/i, async () =>
      raw.exec(`UPDATE "oauthConsent" SET "userId" = 'owner'`),
    );

    await expectGrantRevoked(await runAuthHandler(env, exchange("code", DEV_REDIRECT, DEV_BASIC)));
    expect(tokenIds(raw)).toEqual({ access: 0, refresh: 0 });
  });

  it("keeps an unrelated failure at the token endpoint a bare 500", async () => {
    const { raw, env, interruptBefore } = setup();
    consent(raw);
    refreshToken(raw, "rt");
    interruptBefore(/^insert into "oauthRefreshToken"/i, async () =>
      raw.exec(`ALTER TABLE "oauthRefreshToken" RENAME TO "moved"`),
    );

    const response = await runAuthHandler(env, refresh("rt"));

    expect(response.status).toBe(500);
    expect(response.statusText).toBe("Internal Server Error");
    await expect(response.text()).resolves.toBe("");
    expect(console.error).toHaveBeenCalledWith("Better Auth request failed", expect.any(Error));
  });

  it("stops an opaque access token when its consent row is deleted", async () => {
    const { raw, env } = setup();
    consent(raw);
    refreshToken(raw, "rt");
    const issued = (await (await runAuthHandler(env, refresh("rt"))).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const before = await runAuthHandler(env, userinfo(issued.access_token));
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({ sub: "user-1" });

    raw.exec(`DELETE FROM "oauthConsent" WHERE id = 'consent'`);

    expect((await runAuthHandler(env, userinfo(issued.access_token))).status).toBe(401);
    const refreshed = await runAuthHandler(env, refresh(issued.refresh_token));
    expect(refreshed.status).toBe(400);
    await expect(refreshed.json()).resolves.toMatchObject({ error: "invalid_grant" });
    expect(tokenIds(raw)).toEqual({ access: 0, refresh: 0 });
  });

  it("issues a JWT from a code that carries a stored resource, which Accounts then refuses", async () => {
    const { raw, env } = setup();
    const accessToken = await developerJwt(env, raw);
    expect(decodeJwt(accessToken)).toMatchObject({ azp: "dev-app", aud: USERINFO });
    expect(tokenIds(raw)).toEqual({ access: 0, refresh: 0 });

    expect((await getAuth(env).handler(userinfo(accessToken))).status).toBe(200);
    await expectInvalidToken(await runAuthHandler(env, userinfo(accessToken)));
    await expectInvalidToken(
      await runAuthHandler(env, form(USERINFO, { access_token: accessToken })),
    );
  });

  it("reports a developer client's JWT inactive at introspection", async () => {
    const { raw, env } = setup();
    const accessToken = await developerJwt(env, raw);

    const library = await getAuth(env).handler(introspect(accessToken, DEV_BASIC));
    await expect(library.json()).resolves.toMatchObject({ active: true });
    const response = await runAuthHandler(env, introspect(`Bearer ${accessToken}`, DEV_BASIC));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ active: false });

    const unauthenticated = await runAuthHandler(env, introspect(accessToken));
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({ error: "invalid_client" });
  });

  it("leaves a first-party client's JWT readable", async () => {
    const { raw, env } = setup();
    authorizationCode(raw, {
      code: "fp-code",
      clientId: "fp-wiki",
      redirectUri: FP_REDIRECT,
      scope: "openid email",
      resource: USERINFO,
    });
    const issued = await runAuthHandler(env, exchange("fp-code", FP_REDIRECT, FP_BASIC));
    const { access_token: accessToken } = (await issued.json()) as { access_token: string };
    expect(decodeJwt(accessToken)).toMatchObject({ azp: "fp-wiki" });

    const me = await runAuthHandler(env, userinfo(accessToken));
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ sub: "user-1" });
    const introspected = await runAuthHandler(env, introspect(accessToken, FP_BASIC));
    await expect(introspected.json()).resolves.toMatchObject({
      active: true,
      client_id: "fp-wiki",
    });
  });

  it("refuses a resource whose Basic identity only Better Auth decodes", async () => {
    const { raw, env } = setup();
    for (const code of ["library", "gate"]) {
      authorizationCode(raw, {
        code,
        clientId: "dev-app",
        redirectUri: DEV_REDIRECT,
        scope: "openid email",
      });
    }
    const request = (code: string) =>
      exchange(code, DEV_REDIRECT, basicFor("dev-app", "dev?secret", "base64url"), {
        client_id: "fp-wiki",
        resource: USERINFO,
      });
    expect(basicFor("dev-app", "dev?secret", "base64url")).not.toBe(DEV_BASIC);

    const library = await getAuth(env).handler(request("library"));
    expect(library.status).toBe(200);
    const { access_token: accessToken } = (await library.json()) as { access_token: string };
    expect(decodeJwt(accessToken)).toMatchObject({ azp: "dev-app" });

    const refused = await runAuthHandler(env, request("gate"));
    expect(refused.status).toBe(400);
    await expect(refused.json()).resolves.toMatchObject({ error: "invalid_target" });
  });

  it("leaves a non-form token request to Better Auth, which refuses its media type", async () => {
    const { env } = setup();
    const response = await runAuthHandler(
      env,
      new Request(TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: DEV_BASIC },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: "rt",
          resource: USERINFO,
        }),
      }),
    );

    expect(response.status).toBe(415);
  });
});

describe("refuseDeveloperClientUserInfo", () => {
  const developerToken = (azp: unknown) =>
    [
      Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
      Buffer.from(JSON.stringify({ azp })).toString("base64url"),
      "signature",
    ].join(".");

  it.each([
    ["a Bearer header", userinfo(developerToken("dev-app"))],
    [
      "a DPoP header",
      new Request(USERINFO, { headers: { Authorization: `DPoP ${developerToken("dev-app")}` } }),
    ],
    [
      "a header without a scheme",
      new Request(USERINFO, { headers: { Authorization: developerToken("dev-app") } }),
    ],
    ["a form body", form(USERINFO, { access_token: developerToken("dev-app") })],
    [
      "a second form value",
      new Request(USERINFO, {
        method: "POST",
        headers: { "content-type": FORM },
        body: `access_token=opaque&access_token=${developerToken("dev-app")}`,
      }),
    ],
  ])("refuses a developer client's JWT in %s", async (_name, request) => {
    const { db } = setup();

    const response = await refuseDeveloperClientUserInfo(db, request);

    expect(response).not.toBeNull();
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    await expectInvalidToken(response as Response);
  });

  it.each([
    ["a first-party client's JWT", userinfo(developerToken("fp-wiki"))],
    ["a JWT for an unknown client", userinfo(developerToken("missing"))],
    ["a JWT without a string azp", userinfo(developerToken(7))],
    ["an opaque token", userinfo("opaque-token")],
    ["no token", new Request(USERINFO)],
    [
      "a developer JWT in a GET body-less query",
      new Request(`${USERINFO}?access_token=${developerToken("dev-app")}`),
    ],
    [
      "a developer JWT in a non-form body",
      new Request(USERINFO, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: `access_token=${developerToken("dev-app")}`,
      }),
    ],
    [
      "a developer JWT sent to another endpoint",
      form(TOKEN, {}, `Bearer ${developerToken("dev-app")}`),
    ],
    [
      "a developer JWT in a PUT body, which Better Auth does not route",
      new Request(USERINFO, {
        method: "PUT",
        headers: { "content-type": FORM },
        body: `access_token=${developerToken("dev-app")}`,
      }),
    ],
  ])("lets %s through", async (_name, request) => {
    const { db } = setup();

    await expect(refuseDeveloperClientUserInfo(db, request)).resolves.toBeNull();
  });

  it("does not query D1 for a token that names no client", async () => {
    const db = {
      prepare: () => {
        throw new Error("unexpected query");
      },
    } as unknown as D1Database;

    for (const request of [
      userinfo("opaque-token"),
      userinfo(developerToken(7)),
      new Request(USERINFO),
    ]) {
      await expect(refuseDeveloperClientUserInfo(db, request)).resolves.toBeNull();
    }
  });
});

describe("introspectsDeveloperClientJwt", () => {
  it("recognizes only a developer JWT sent for introspection", async () => {
    const { raw, env, db } = setup();
    const accessToken = await developerJwt(env, raw);

    await expect(introspectsDeveloperClientJwt(db, introspect(accessToken))).resolves.toBe(true);
    await expect(
      introspectsDeveloperClientJwt(db, introspect(`Bearer ${accessToken}`)),
    ).resolves.toBe(true);
    await expect(introspectsDeveloperClientJwt(db, introspect("opaque"))).resolves.toBe(false);
    await expect(introspectsDeveloperClientJwt(db, userinfo(accessToken))).resolves.toBe(false);
    await expect(
      introspectsDeveloperClientJwt(db, form(TOKEN, { token: accessToken })),
    ).resolves.toBe(false);
  });

  it("answers inactive without caching", async () => {
    const response = inactiveIntrospection();

    expect(response.status).toBe(200);
    expect(response.headers.get("Pragma")).toBe("no-cache");
    await expect(response.json()).resolves.toEqual({ active: false });
  });
});

describe("grantRemovedDuringIssuance", () => {
  const refusal = new Error("D1_ERROR: developer client token without consent: SQLITE_CONSTRAINT");

  it("maps the consent trigger's abort at the token endpoint", async () => {
    const response = grantRemovedDuringIssuance(new Request(TOKEN, { method: "POST" }), refusal);

    expect(response).not.toBeNull();
    await expectGrantRevoked(response as Response);
  });

  it.each([
    ["the abort at another endpoint", new Request(USERINFO), refusal],
    ["another error at the token endpoint", new Request(TOKEN), new Error("D1_ERROR: busy")],
    ["a thrown string", new Request(TOKEN), "developer client token without consent"],
  ])("leaves %s alone", (_name, request, error) => {
    expect(grantRemovedDuringIssuance(request, error)).toBeNull();
  });
});
