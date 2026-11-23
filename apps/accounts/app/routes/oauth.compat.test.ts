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

import { action } from "./oauth.compat";

function args(clientId: string) {
  const request = new Request(`${ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: "c",
      resource: RESOURCE,
    }),
  });
  return { request, context: { cloudflare: { env: testEnv() } } } as never;
}

describe("/oauth/token with a resource indicator", () => {
  beforeEach(() => {
    handler.mockClear();
  });

  it("refuses a developer client", async () => {
    const response = await action(args("dev-app"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_target" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a first-party client to Better Auth's token endpoint", async () => {
    const response = await action(args("fp-wiki"));

    await expect(response.text()).resolves.toBe("better-auth");
    const forwarded = handler.mock.calls[0]?.[0];
    expect(forwarded && new URL(forwarded.url).pathname).toBe("/api/auth/oauth2/token");
    await expect(forwarded?.text()).resolves.toContain("resource=");
  });
});
