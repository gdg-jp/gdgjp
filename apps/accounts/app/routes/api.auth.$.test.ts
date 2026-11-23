import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => vi.fn(async (_request: Request) => new Response("better-auth")));

vi.mock("better-auth", () => ({
  betterAuth: () => ({ handler, api: {}, $context: Promise.resolve({}) }),
}));
vi.mock("better-auth/plugins", () => ({ jwt: () => ({}) }));
vi.mock("@better-auth/oauth-provider", () => ({ oauthProvider: () => ({}) }));

const ORIGIN = "https://accounts.example";
const RESOURCE = `${ORIGIN}/api/auth/oauth2/userinfo`;
const DEV_REDIRECT = "https://dev.example/callback";

function testEnv() {
  const raw = new DatabaseSync(":memory:");
  const directory = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).sort()) {
    raw.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  raw.exec(`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Owner', 'o@example.com')`);
  raw.exec(`INSERT INTO "oauthClient" (id, "clientId", "redirectUris", "userId") VALUES
    ('c1', 'dev-app', '["${DEV_REDIRECT}"]', 'owner'),
    ('c2', 'fp-wiki', '["https://wiki.example/callback"]', NULL)`);
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => raw.prepare(sql).all(...params)[0] ?? null,
  });
  return {
    APP_URL: ORIGIN,
    DB: { prepare: (sql: string) => statement(sql) },
  } as unknown as Env;
}

import { action, loader } from "./api.auth.$";

function authorizeUrl(clientId: string, redirectUri: string) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    resource: RESOURCE,
    state: "st",
  });
  return `${ORIGIN}/api/auth/oauth2/authorize?${query}`;
}

function tokenRequest(clientId: string) {
  return new Request(`${ORIGIN}/api/auth/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:secret`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "r",
      resource: RESOURCE,
    }),
  });
}

function args(request: Request) {
  return { request, context: { cloudflare: { env: testEnv() } } } as never;
}

describe("/api/auth/* with a resource indicator", () => {
  beforeEach(() => {
    handler.mockClear();
  });

  it("refuses a developer client's authorization request", async () => {
    const response = (await loader(
      args(new Request(authorizeUrl("dev-app", DEV_REDIRECT))),
    )) as Response;

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("Location") ?? "").searchParams.get("error")).toBe(
      "invalid_target",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a developer client's form-posted authorization request", async () => {
    const request = new Request(`${ORIGIN}/api/auth/oauth2/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URL(authorizeUrl("dev-app", DEV_REDIRECT)).searchParams,
    });

    const response = (await action(args(request))) as Response;

    expect(response.status).toBe(302);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a developer client's token request", async () => {
    const response = (await action(args(tokenRequest("dev-app")))) as Response;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_target" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a first-party client's requests to Better Auth", async () => {
    const authorize = (await loader(
      args(new Request(authorizeUrl("fp-wiki", "https://wiki.example/callback"))),
    )) as Response;
    const token = (await action(args(tokenRequest("fp-wiki")))) as Response;

    await expect(authorize.text()).resolves.toBe("better-auth");
    await expect(token.text()).resolves.toBe("better-auth");
    expect(handler.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
      "/api/auth/oauth2/authorize",
      "/api/auth/oauth2/token",
    ]);
    await expect(handler.mock.calls[1]?.[0].text()).resolves.toContain("resource=");
  });
});
