import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  runAuthHandler: vi.fn(),
  verifyOAuthQueryParams: vi.fn(),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  verifyOAuthQueryParams: authMocks.verifyOAuthQueryParams,
}));

vi.mock("~/features/auth/auth.server", () => ({
  runAuthHandler: authMocks.runAuthHandler,
}));

vi.mock("~/lib/i18n/i18n.server", () => ({
  i18n: {
    getFixedT: vi.fn(async () => (key: string) => key),
  },
}));

import {
  actOnOauthConsent,
  loadOauthConsent,
  safeHttpUrl,
} from "~/features/oauth/oauth-consent.server";

function migratedDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).sort()) {
    raw.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => raw.prepare(sql).all(...params)[0] ?? null,
  });
  raw.exec(
    `INSERT INTO "user" (id, name, email) VALUES ('owner', '  Ada Owner ', 'ada@example.com')`,
  );
  raw.exec(`INSERT INTO "oauthClient" (id, "clientId", name, uri, "redirectUris", "userId", disabled)
    VALUES
      ('1', 'dev-app', ' Dev App ', 'https://dev.example', '[]', 'owner', 0),
      ('2', 'off-app', 'Off App', 'https://off.example', '[]', 'owner', 1),
      ('3', 'bare-app', NULL, 'javascript:alert(1)', '[]', NULL, NULL)`);
  return { raw, db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database };
}

function consentPage(query: string, db: D1Database) {
  return {
    request: new Request(`https://accounts.example/oauth/consent?${query}`),
    context: { cloudflare: { env: { DB: db, BETTER_AUTH_SECRET: "secret" } as unknown as Env } },
  } as never;
}

describe("loadOauthConsent", () => {
  beforeEach(() => {
    authMocks.verifyOAuthQueryParams.mockReset();
  });

  it("names the app, its owner and the requested scopes of a signed request", async () => {
    authMocks.verifyOAuthQueryParams.mockResolvedValue(true);
    const { db } = migratedDb();
    const query = "client_id=dev-app&scope=openid+email&sig=s&exp=1";

    await expect(loadOauthConsent(consentPage(query, db))).resolves.toEqual({
      valid: true,
      client: { name: "Dev App", appUrl: "https://dev.example/", ownerName: "Ada Owner" },
      scopes: ["openid", "email"],
      title: "meta.oauthConsent",
    });
    expect(authMocks.verifyOAuthQueryParams).toHaveBeenCalledWith(query, "secret");
  });

  it("reveals nothing about the client when the signature does not verify", async () => {
    authMocks.verifyOAuthQueryParams.mockResolvedValue(false);
    const { db } = migratedDb();

    await expect(
      loadOauthConsent(consentPage("client_id=dev-app&scope=openid&sig=bad", db)),
    ).resolves.toEqual({ valid: false, client: null, scopes: [], title: "meta.oauthConsent" });
  });

  it.each(["client_id=off-app&scope=openid", "client_id=missing&scope=openid", "scope=openid"])(
    "treats a disabled, unknown or missing client as invalid: %s",
    async (query) => {
      authMocks.verifyOAuthQueryParams.mockResolvedValue(true);
      const { db } = migratedDb();

      await expect(loadOauthConsent(consentPage(query, db))).resolves.toMatchObject({
        valid: false,
        client: null,
        scopes: [],
      });
    },
  );

  it("shows a client without a name, website or owner", async () => {
    authMocks.verifyOAuthQueryParams.mockResolvedValue(true);
    const { db } = migratedDb();

    await expect(loadOauthConsent(consentPage("client_id=bare-app", db))).resolves.toEqual({
      valid: true,
      client: { name: "", appUrl: null, ownerName: null },
      scopes: [],
      title: "meta.oauthConsent",
    });
  });
});

describe("safeHttpUrl", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["http://localhost:3000", "http://localhost:3000/"],
    ["ftp://example.com", null],
    ["not a url", null],
    ["", null],
    [null, null],
  ])("%o becomes %o", (value, expected) => {
    expect(safeHttpUrl(value)).toBe(expected);
  });
});

function consentRequest(accept: "true" | "false", oauthQuery = "client_id=c1&sig=s") {
  const form = new FormData();
  form.set("oauth_query", oauthQuery);
  form.set("accept", accept);
  return new Request("https://accounts.example/oauth/consent", {
    method: "POST",
    headers: {
      origin: "https://accounts.example",
      cookie: "gdgjp-accounts.session_token=tok",
    },
    body: form,
  });
}

describe("actOnOauthConsent", () => {
  beforeEach(() => {
    authMocks.runAuthHandler.mockReset();
  });

  it("redirects to the url returned by Better Auth 1.7 consent endpoint", async () => {
    authMocks.runAuthHandler.mockResolvedValue(
      Response.json({ redirect: true, url: "https://rp.example/callback?code=abc" }),
    );

    const thrown = await actOnOauthConsent({
      request: consentRequest("true"),
      context: { cloudflare: { env: {} as Env } },
    } as never).catch((value: unknown) => value);

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://rp.example/callback?code=abc");
    const forwarded = authMocks.runAuthHandler.mock.calls[0]?.[1] as Request;
    expect(forwarded.headers.get("origin")).toBe("https://accounts.example");
    expect(forwarded.headers.get("cookie")).toBe("gdgjp-accounts.session_token=tok");
  });

  it("falls back to redirect_uri when present", async () => {
    authMocks.runAuthHandler.mockResolvedValue(
      Response.json({ redirect_uri: "https://rp.example/callback?code=legacy" }),
    );

    const thrown = await actOnOauthConsent({
      request: consentRequest("true"),
      context: { cloudflare: { env: {} as Env } },
    } as never).catch((value: unknown) => value);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe(
      "https://rp.example/callback?code=legacy",
    );
  });

  it("returns 500 when the consent payload omits a redirect target", async () => {
    authMocks.runAuthHandler.mockResolvedValue(Response.json({ ok: true }));

    const response = await actOnOauthConsent({
      request: consentRequest("true"),
      context: { cloudflare: { env: {} as Env } },
    } as never);

    expect(response.status).toBe(500);
  });
});
