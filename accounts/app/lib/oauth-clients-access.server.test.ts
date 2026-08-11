import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));

vi.mock("./auth.server", () => ({
  CHAPTERS_SCOPE: "https://gdgs.jp/scopes/chapters",
  CLI_SCOPE: "https://gdgs.jp/scopes/cli",
  requireUser: authMocks.requireUser,
  trustedOAuthClientIds: (env: Env) =>
    [
      env.TINYURL_CLIENT_ID,
      env.WIKI_CLIENT_ID,
      env.IMG_CLIENT_ID,
      env.SCHEDULER_CLIENT_ID,
      env.SNS_CLIENT_ID,
      env.AGENTS_CLIENT_ID,
      env.PAY_CLIENT_ID,
    ].filter(Boolean),
}));

import {
  createDeveloperClient,
  getDeveloperClient,
  listDeveloperClients,
  requireDeveloperAccess,
  setDeveloperClientEnabled,
  updateDeveloperClient,
} from "./oauth-clients.server";

const user = {
  id: "user-1",
  email: "member@example.com",
  name: "Member",
  image: null,
  isAdmin: false,
};

const clientRow = {
  clientId: "client-1",
  name: "Example",
  uri: "https://example.com/",
  redirectUris: JSON.stringify(["https://example.com/callback"]),
  postLogoutRedirectUris: JSON.stringify(["https://example.com/signed-out"]),
  scopes: JSON.stringify(["openid", "email"]),
  disabled: 0,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

type Call = { sql: string; args: unknown[]; operation: "first" | "all" | "run" };

function testEnv(options?: {
  active?: boolean;
  ownedClient?: typeof clientRow | null;
  cliToken?: { userId: string; scopes: string } | null;
}) {
  const calls: Call[] = [];
  const batches: string[][] = [];
  const active = options?.active ?? true;
  const ownedClient = options && "ownedClient" in options ? options.ownedClient : clientRow;
  const cliToken = options?.cliToken ?? null;

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async first() {
          calls.push({ sql, args, operation: "first" });
          if (sql.includes("FROM memberships")) return active ? { ok: 1 } : null;
          if (sql.includes("FROM oauthAccessToken")) return cliToken;
          if (sql.includes("FROM oauthClient")) return ownedClient;
          return null;
        },
        async all() {
          calls.push({ sql, args, operation: "all" });
          return { results: ownedClient ? [ownedClient] : [] };
        },
        async run() {
          calls.push({ sql, args, operation: "run" });
          return { meta: { changes: 1 } };
        },
      };
      return statement as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      batches.push(
        statements.map(
          (statement) =>
            calls.find((call) => call.operation === "run" && call.sql === String(statement))?.sql ??
            String(statement),
        ),
      );
      // D1 statements are opaque, so assertions use prepare calls recorded below.
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };

  const preparedSql: string[] = [];
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    preparedSql.push(sql);
    return originalPrepare(sql);
  }) as typeof db.prepare;

  const env = {
    DB: db as D1Database,
    TINYURL_CLIENT_ID: "tinyurl",
    WIKI_CLIENT_ID: "wiki",
    IMG_CLIENT_ID: "img",
    SCHEDULER_CLIENT_ID: "scheduler",
    SNS_CLIENT_ID: "sns",
    AGENTS_CLIENT_ID: "agents",
    PAY_CLIENT_ID: "pay",
  } as Env;
  return { env, calls, batches, preparedSql };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.requireUser.mockResolvedValue(user);
});

describe("developer client access", () => {
  it("requires an active membership even for a super admin", async () => {
    authMocks.requireUser.mockResolvedValue({ ...user, isAdmin: true });
    const { env } = testEnv({ active: false });

    await expect(
      requireDeveloperAccess(env, new Request("https://accounts.example")),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lists only rows bound to the authenticated owner", async () => {
    const { env, calls } = testEnv();
    const clients = await listDeveloperClients(env, new Request("https://accounts.example"));

    expect(clients).toHaveLength(1);
    const list = calls.find((call) => call.operation === "all");
    expect(list?.sql).toContain("WHERE userId = ?");
    expect(list?.args).toEqual([user.id]);
  });

  it("returns 404 for another user's or a trusted client", async () => {
    const request = new Request("https://accounts.example");
    const { env: missingEnv } = testEnv({ ownedClient: null });
    await expect(getDeveloperClient(missingEnv, request, "other-client")).rejects.toMatchObject({
      status: 404,
    });

    const { env: trustedEnv } = testEnv();
    await expect(getDeveloperClient(trustedEnv, request, "tinyurl")).rejects.toMatchObject({
      status: 404,
    });
    await expect(getDeveloperClient(trustedEnv, request, "sns")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("creates a confidential PKCE client and returns its secret once", async () => {
    const { env, calls } = testEnv();

    const result = await createDeveloperClient(env, new Request("https://accounts.example"), {
      name: "Example",
      appUrl: "https://example.com/",
      redirectUris: ["https://example.com/callback"],
      scopes: ["openid", "email"],
    });

    expect(result.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const insert = calls.find(
      (call) => call.operation === "run" && call.sql.includes("INSERT INTO oauthClient"),
    );
    expect(insert?.sql).toContain("skipConsent");
    expect(insert?.sql).toContain("enableEndSession");
    expect(insert?.sql).toContain("requirePKCE");
    expect(insert?.sql).toContain("client_secret_basic");
  });

  it("revokes access and refresh tokens when disabling a client", async () => {
    const { env, preparedSql } = testEnv();
    await setDeveloperClientEnabled(
      env,
      new Request("https://accounts.example"),
      "client-1",
      false,
    );

    expect(preparedSql).toContain("DELETE FROM oauthAccessToken WHERE clientId = ?");
    expect(preparedSql).toContain("DELETE FROM oauthRefreshToken WHERE clientId = ?");
  });

  it("revokes existing tokens when registered scopes change", async () => {
    const { env, preparedSql } = testEnv();
    await updateDeveloperClient(env, new Request("https://accounts.example"), "client-1", {
      name: "Example",
      appUrl: "https://example.com/",
      redirectUris: ["https://example.com/callback"],
      postLogoutRedirectUris: ["https://example.com/signed-out"],
      scopes: ["openid", "profile"],
    });

    expect(preparedSql).toContain("DELETE FROM oauthAccessToken WHERE clientId = ?");
    expect(preparedSql).toContain("DELETE FROM oauthRefreshToken WHERE clientId = ?");
  });

  it("accepts a valid scoped gdg-cli bearer token", async () => {
    const { env, calls } = testEnv({
      cliToken: { userId: user.id, scopes: '["openid","https://gdgs.jp/scopes/cli"]' },
    });

    await listDeveloperClients(
      env,
      new Request("https://accounts.example", {
        headers: { Authorization: "Bearer cli-access-token" },
      }),
    );

    const tokenLookup = calls.find((call) => call.sql.includes("FROM oauthAccessToken"));
    expect(tokenLookup?.args).toContain("cli-access-token");
    expect(tokenLookup?.args).toContain("gdg-cli");
  });

  it("rejects CLI tokens without the CLI scope", async () => {
    const { env } = testEnv({ cliToken: { userId: user.id, scopes: '["openid"]' } });

    await expect(
      listDeveloperClients(
        env,
        new Request("https://accounts.example", {
          headers: { Authorization: "Bearer cli-access-token" },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(authMocks.requireUser).not.toHaveBeenCalled();
  });
});
