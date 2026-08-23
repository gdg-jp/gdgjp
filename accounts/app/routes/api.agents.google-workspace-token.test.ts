import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthClientsMock = vi.hoisted(() => ({ requireCliTokenUser: vi.fn() }));
vi.mock("~/lib/oauth-clients.server", () => ({
  requireCliTokenUser: oauthClientsMock.requireCliTokenUser,
}));

const workspaceMock = vi.hoisted(() => ({ refreshWorkspaceAccessToken: vi.fn() }));
vi.mock("~/lib/google-workspace.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/google-workspace.server")>(
    "~/lib/google-workspace.server",
  );
  return { ...actual, refreshWorkspaceAccessToken: workspaceMock.refreshWorkspaceAccessToken };
});

import {
  revokeWorkspaceConnection,
  upsertWorkspaceConnection,
} from "~/lib/google-workspace.server";
import { action } from "./api.agents.google-workspace-token";

const SERVICE_ACCOUNT_ID = "gdgagent-svc-user-id";
const TARGET_USER_ID = "target-user";

function testEnv(db: unknown) {
  return {
    APP_URL: "https://accounts.example",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GOOGLE_WORKSPACE_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(3)).toString("base64"),
    AGENTS_SERVICE_ACCOUNT_USER_ID: SERVICE_ACCOUNT_ID,
    DB: db,
  };
}

type ConnectionRow = {
  userId: string;
  refreshTokenCiphertext: string;
  refreshTokenNonce: string;
  encryptionKeyVersion: number;
  scope: string;
  connectedAt: string;
  updatedAt: string;
  revokedAt: string | null;
};
type AuditRow = {
  id: string;
  callerUserId: string;
  targetUserId: string;
  outcome: string;
  createdAt: string;
};
type RateLimitRow = { callerUserId: string; windowStart: number; count: number };

function fakeDb() {
  const connections = new Map<string, ConnectionRow>();
  const audits: AuditRow[] = [];
  const rateLimits = new Map<string, RateLimitRow>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async run() {
          if (sql.startsWith("INSERT INTO googleWorkspaceConnection")) {
            const [userId, ciphertext, nonce, keyVersion, scope, connectedAt, updatedAt] = args as [
              string,
              string,
              string,
              number,
              string,
              string,
              string,
            ];
            connections.set(userId, {
              userId,
              refreshTokenCiphertext: ciphertext,
              refreshTokenNonce: nonce,
              encryptionKeyVersion: keyVersion,
              scope,
              connectedAt,
              updatedAt,
              revokedAt: null,
            });
            return { success: true, meta: {} };
          }
          if (sql.startsWith("UPDATE googleWorkspaceConnection SET revokedAt")) {
            const [revokedAt, updatedAt, userId] = args as [string, string, string];
            const existing = connections.get(userId);
            if (existing) connections.set(userId, { ...existing, revokedAt, updatedAt });
            return { success: true, meta: {} };
          }
          if (sql.startsWith("INSERT INTO googleWorkspaceTokenAudit")) {
            const [id, callerUserId, targetUserId, outcome, createdAt] = args as string[];
            audits.push({ id, callerUserId, targetUserId, outcome, createdAt });
            return { success: true, meta: {} };
          }
          throw new Error(`unhandled run(): ${sql}`);
        },
        async first<T>(): Promise<T | null> {
          if (sql.startsWith("SELECT userId, refreshTokenCiphertext")) {
            const [userId] = args as [string];
            return (connections.get(userId) ?? null) as T | null;
          }
          if (sql.startsWith("INSERT INTO googleWorkspaceTokenRateLimit")) {
            const [callerUserId, windowStart] = args as [string, number];
            const existing = rateLimits.get(callerUserId);
            const count = existing && existing.windowStart === windowStart ? existing.count + 1 : 1;
            rateLimits.set(callerUserId, { callerUserId, windowStart, count });
            return { count } as T;
          }
          throw new Error(`unhandled first(): ${sql}`);
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, audits };
}

function tokenRequest(body: unknown, authorization = "Bearer valid-token") {
  return new Request("https://accounts.example/api/agents/google-workspace-token", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  oauthClientsMock.requireCliTokenUser.mockReset();
  workspaceMock.refreshWorkspaceAccessToken.mockReset();
});

describe("api/agents/google-workspace-token", () => {
  it("rejects a caller with no Authorization header", async () => {
    const { db } = fakeDb();
    const response = await action({
      request: new Request("https://accounts.example/api/agents/google-workspace-token", {
        method: "POST",
      }),
      context: { cloudflare: { env: testEnv(db) } },
    } as never);
    expect(response.status).toBe(401);
  });

  it("rejects a caller whose bearer token isn't a valid gdg-cli access token", async () => {
    oauthClientsMock.requireCliTokenUser.mockRejectedValue(new Response("Unauthorized"));
    const { db } = fakeDb();
    const response = await action({
      request: tokenRequest({ userId: TARGET_USER_ID }),
      context: { cloudflare: { env: testEnv(db) } },
    } as never);
    expect(response.status).toBe(401);
  });

  it("rejects any caller other than the pre-registered gdgagent-svc identity", async () => {
    oauthClientsMock.requireCliTokenUser.mockResolvedValue({ id: "some-other-user" });
    const { db, audits } = fakeDb();
    const response = await action({
      request: tokenRequest({ userId: TARGET_USER_ID }),
      context: { cloudflare: { env: testEnv(db) } },
    } as never);
    expect(response.status).toBe(403);
    expect(audits.at(-1)?.outcome).toBe("forbidden_caller");
    expect(workspaceMock.refreshWorkspaceAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a target user with no Workspace connection", async () => {
    oauthClientsMock.requireCliTokenUser.mockResolvedValue({ id: SERVICE_ACCOUNT_ID });
    const { db, audits } = fakeDb();
    const response = await action({
      request: tokenRequest({ userId: "never-connected" }),
      context: { cloudflare: { env: testEnv(db) } },
    } as never);
    expect(response.status).toBe(404);
    expect(audits.at(-1)?.outcome).toBe("not_connected");
  });

  it("rejects a target user whose connection was revoked", async () => {
    oauthClientsMock.requireCliTokenUser.mockResolvedValue({ id: SERVICE_ACCOUNT_ID });
    const { db, audits } = fakeDb();
    const env = testEnv(db) as unknown as Env;
    await upsertWorkspaceConnection(env, db, TARGET_USER_ID, "refresh-token", "scope");
    await revokeWorkspaceConnection(db, TARGET_USER_ID);

    const response = await action({
      request: tokenRequest({ userId: TARGET_USER_ID }),
      context: { cloudflare: { env: testEnv(db) } },
    } as never);
    expect(response.status).toBe(404);
    expect(audits.at(-1)?.outcome).toBe("not_connected");
  });

  it("vends only a short-lived access token, never the refresh token", async () => {
    oauthClientsMock.requireCliTokenUser.mockResolvedValue({ id: SERVICE_ACCOUNT_ID });
    const { db, audits } = fakeDb();
    const env = testEnv(db) as unknown as Env;
    await upsertWorkspaceConnection(env, db, TARGET_USER_ID, "the-refresh-token", "scope-a");
    workspaceMock.refreshWorkspaceAccessToken.mockResolvedValue({
      ok: true,
      accessToken: "short-lived-access-token",
      expiresIn: 3599,
    });

    const response = await action({
      request: tokenRequest({ userId: TARGET_USER_ID }),
      context: { cloudflare: { env: testEnv(db) } },
    } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ access_token: "short-lived-access-token", expires_in: 3599 });
    expect(JSON.stringify(body)).not.toContain("the-refresh-token");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(audits.at(-1)?.outcome).toBe("ok");
  });

  it("rate-limits the caller after too many requests in the window", async () => {
    oauthClientsMock.requireCliTokenUser.mockResolvedValue({ id: SERVICE_ACCOUNT_ID });
    const { db, audits } = fakeDb();
    const env = testEnv(db) as unknown as Env;
    await upsertWorkspaceConnection(env, db, TARGET_USER_ID, "the-refresh-token", "scope-a");
    workspaceMock.refreshWorkspaceAccessToken.mockResolvedValue({
      ok: true,
      accessToken: "at",
      expiresIn: 3600,
    });

    let last: Response | undefined;
    for (let i = 0; i < 25; i++) {
      last = await action({
        request: tokenRequest({ userId: TARGET_USER_ID }),
        context: { cloudflare: { env: testEnv(db) } },
      } as never);
    }
    expect(last?.status).toBe(429);
    expect(audits.at(-1)?.outcome).toBe("rate_limited");
  });
});
