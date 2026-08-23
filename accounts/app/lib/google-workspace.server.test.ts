import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_WORKSPACE_SCOPES,
  TOKEN_VEND_RATE_LIMIT_MAX,
  consumeWorkspaceOauthState,
  createWorkspaceOauthState,
  decryptRefreshToken,
  encryptRefreshToken,
  exchangeWorkspaceCode,
  getWorkspaceConnection,
  reencryptWorkspaceConnectionIfStale,
  refreshWorkspaceAccessToken,
  reserveTokenVendQuota,
  revokeWorkspaceConnection,
  upsertWorkspaceConnection,
  workspaceAuthorizeUrl,
  workspaceRedirectUri,
} from "./google-workspace.server";

const TEST_ENV = {
  APP_URL: "https://accounts.example",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GOOGLE_WORKSPACE_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"),
} as unknown as Env;

type StateRow = {
  id: string;
  userId: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: string;
  expiresAt: string;
};

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

function createFakeDb() {
  const states: StateRow[] = [];
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
          if (sql.startsWith("DELETE FROM googleWorkspaceOauthState WHERE expiresAt")) {
            const [now] = args as [string];
            for (let i = states.length - 1; i >= 0; i--) {
              if (states[i].expiresAt <= now) states.splice(i, 1);
            }
            return { success: true, meta: {} };
          }
          if (sql.startsWith("INSERT INTO googleWorkspaceOauthState")) {
            const [id, userId, codeVerifier, returnTo, createdAt, expiresAt] = args as string[];
            states.push({ id, userId, codeVerifier, returnTo, createdAt, expiresAt });
            return { success: true, meta: {} };
          }
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
            const existing = connections.get(userId);
            connections.set(userId, {
              userId,
              refreshTokenCiphertext: ciphertext,
              refreshTokenNonce: nonce,
              encryptionKeyVersion: keyVersion,
              scope,
              connectedAt: existing ? existing.connectedAt : connectedAt,
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
          if (sql.startsWith("DELETE FROM googleWorkspaceOauthState WHERE id")) {
            const [id] = args as [string];
            const index = states.findIndex((s) => s.id === id);
            if (index === -1) return null;
            const [row] = states.splice(index, 1);
            return {
              userId: row.userId,
              codeVerifier: row.codeVerifier,
              returnTo: row.returnTo,
              expiresAt: row.expiresAt,
            } as T;
          }
          if (sql.startsWith("SELECT userId, refreshTokenCiphertext")) {
            const [userId] = args as [string];
            return (connections.get(userId) ?? null) as T | null;
          }
          if (sql.startsWith("SELECT COUNT(*) AS count FROM googleWorkspaceTokenAudit")) {
            const [callerUserId, since] = args as [string, string];
            const count = audits.filter(
              (a) => a.callerUserId === callerUserId && a.createdAt > since,
            ).length;
            return { count } as T;
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
  return { db: db as unknown as D1Database, states, connections, audits, rateLimits };
}

describe("encryptRefreshToken / decryptRefreshToken", () => {
  it("round-trips a refresh token", async () => {
    const { ciphertext, nonce, keyVersion } = await encryptRefreshToken(
      TEST_ENV,
      "user-1",
      "refresh-token-value",
    );
    const plaintext = await decryptRefreshToken(TEST_ENV, "user-1", keyVersion, ciphertext, nonce);
    expect(plaintext).toBe("refresh-token-value");
  });

  it("fails to decrypt when the ciphertext is presented under a different userId (AAD mismatch)", async () => {
    const { ciphertext, nonce, keyVersion } = await encryptRefreshToken(
      TEST_ENV,
      "user-1",
      "refresh-token-value",
    );
    await expect(
      decryptRefreshToken(TEST_ENV, "user-2", keyVersion, ciphertext, nonce),
    ).rejects.toThrow();
  });

  it("uses a fresh random nonce per encryption", async () => {
    const a = await encryptRefreshToken(TEST_ENV, "user-1", "token");
    const b = await encryptRefreshToken(TEST_ENV, "user-1", "token");
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe("workspace OAuth state", () => {
  it("consumes a valid state exactly once (replay is rejected)", async () => {
    const { db } = createFakeDb();
    const { state } = await createWorkspaceOauthState(db, "user-1", "/dashboard");

    const first = await consumeWorkspaceOauthState(db, state, "user-1");
    expect(first).toEqual({
      ok: true,
      userId: "user-1",
      codeVerifier: expect.any(String),
      returnTo: "/dashboard",
    });

    const replay = await consumeWorkspaceOauthState(db, state, "user-1");
    expect(replay).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a callback presented to a different session than the one that started the flow", async () => {
    const { db } = createFakeDb();
    const { state } = await createWorkspaceOauthState(db, "user-1", "/dashboard");

    const result = await consumeWorkspaceOauthState(db, state, "attacker");
    expect(result).toEqual({ ok: false, reason: "session_mismatch" });

    // Single-use: even the rightful session can't retry after the mismatched attempt.
    const retry = await consumeWorkspaceOauthState(db, state, "user-1");
    expect(retry).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an unknown state", async () => {
    const { db } = createFakeDb();
    const result = await consumeWorkspaceOauthState(db, "nonexistent", "user-1");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an expired state", async () => {
    vi.useFakeTimers();
    const { db } = createFakeDb();
    const { state } = await createWorkspaceOauthState(db, "user-1", "/dashboard");
    vi.advanceTimersByTime(11 * 60 * 1000);

    const result = await consumeWorkspaceOauthState(db, state, "user-1");
    expect(result).toEqual({ ok: false, reason: "expired" });
    vi.useRealTimers();
  });
});

describe("workspaceAuthorizeUrl", () => {
  it("requests offline access, forced consent, and PKCE S256", () => {
    const url = new URL(workspaceAuthorizeUrl(TEST_ENV, "state-value", "challenge-value"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_WORKSPACE_SCOPES.join(" "));
    expect(url.searchParams.get("redirect_uri")).toBe(workspaceRedirectUri(TEST_ENV));
  });
});

describe("Google token endpoint calls", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exchangeWorkspaceCode reports a narrower-than-requested scope grant to the caller", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        access_token: "at",
        refresh_token: "rt",
        scope: "https://www.googleapis.com/auth/userinfo.email",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    ) as unknown as typeof fetch;

    const result = await exchangeWorkspaceCode(TEST_ENV, "code", "verifier");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.grantedScopes).not.toContain(GOOGLE_WORKSPACE_SCOPES[0]);
  });

  it("exchangeWorkspaceCode surfaces a missing refresh_token", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        access_token: "at",
        scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
        expires_in: 3600,
        token_type: "Bearer",
      }),
    ) as unknown as typeof fetch;

    const result = await exchangeWorkspaceCode(TEST_ENV, "code", "verifier");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.refreshToken).toBeNull();
  });

  it("exchangeWorkspaceCode returns ok:false on a Google error response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    ) as unknown as typeof fetch;
    const result = await exchangeWorkspaceCode(TEST_ENV, "bad-code", "verifier");
    expect(result.ok).toBe(false);
  });

  it("refreshWorkspaceAccessToken returns only an access token", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ access_token: "new-access-token", expires_in: 3599 }),
    ) as unknown as typeof fetch;

    const result = await refreshWorkspaceAccessToken(TEST_ENV, "refresh-token");
    expect(result).toEqual({ ok: true, accessToken: "new-access-token", expiresIn: 3599 });
  });
});

describe("connection storage", () => {
  it("reconnect keeps the original connectedAt and clears revokedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { db, connections } = createFakeDb();

    await upsertWorkspaceConnection(TEST_ENV, db, "user-1", "refresh-1", "scope-a");
    const firstConnectedAt = connections.get("user-1")?.connectedAt;

    await revokeWorkspaceConnection(db, "user-1");
    expect(connections.get("user-1")?.revokedAt).not.toBeNull();

    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
    await upsertWorkspaceConnection(TEST_ENV, db, "user-1", "refresh-2", "scope-b");

    const reconnected = connections.get("user-1");
    expect(reconnected?.revokedAt).toBeNull();
    expect(reconnected?.connectedAt).toBe(firstConnectedAt);
    expect(reconnected?.scope).toBe("scope-b");

    vi.useRealTimers();
  });

  it("getWorkspaceConnection returns null when nothing is stored", async () => {
    const { db } = createFakeDb();
    expect(await getWorkspaceConnection(db, "nobody")).toBeNull();
  });
});

describe("reserveTokenVendQuota", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the window's max, then rejects", async () => {
    const { db } = createFakeDb();
    for (let i = 0; i < TOKEN_VEND_RATE_LIMIT_MAX; i++) {
      expect(await reserveTokenVendQuota(db, "gdgagent-svc")).toBe(true);
    }
    expect(await reserveTokenVendQuota(db, "gdgagent-svc")).toBe(false);
    expect(await reserveTokenVendQuota(db, "someone-else")).toBe(true);
  });

  it("resets the count once the window rolls over", async () => {
    const { db } = createFakeDb();
    for (let i = 0; i < TOKEN_VEND_RATE_LIMIT_MAX; i++) {
      await reserveTokenVendQuota(db, "gdgagent-svc");
    }
    expect(await reserveTokenVendQuota(db, "gdgagent-svc")).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    expect(await reserveTokenVendQuota(db, "gdgagent-svc")).toBe(true);
  });
});

describe("reencryptWorkspaceConnectionIfStale", () => {
  it("does nothing when the row is already on the current key version", async () => {
    const { db, connections } = createFakeDb();
    await upsertWorkspaceConnection(TEST_ENV, db, "user-1", "refresh-token", "scope-a");
    const before = connections.get("user-1");
    if (!before) throw new Error("unreachable");

    await reencryptWorkspaceConnectionIfStale(TEST_ENV, db, "user-1", before, "refresh-token");

    expect(connections.get("user-1")).toEqual(before);
  });

  it("re-encrypts and persists under the current key when the row is on an older version", async () => {
    const { db, connections } = createFakeDb();
    await upsertWorkspaceConnection(TEST_ENV, db, "user-1", "refresh-token", "scope-a");
    const current = connections.get("user-1");
    if (!current) throw new Error("unreachable");
    const stale = { ...current, encryptionKeyVersion: 0 };

    await reencryptWorkspaceConnectionIfStale(TEST_ENV, db, "user-1", stale, "refresh-token");

    const updated = connections.get("user-1");
    expect(updated?.encryptionKeyVersion).toBe(current.encryptionKeyVersion);
    expect(updated?.refreshTokenCiphertext).not.toBe(stale.refreshTokenCiphertext);
    const plaintext = await decryptRefreshToken(
      TEST_ENV,
      "user-1",
      updated?.encryptionKeyVersion ?? 0,
      updated?.refreshTokenCiphertext ?? "",
      updated?.refreshTokenNonce ?? "",
    );
    expect(plaintext).toBe("refresh-token");
  });
});

describe("Google token response validation", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exchangeWorkspaceCode rejects a malformed 2xx response instead of throwing", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ token_type: "Bearer" }),
    ) as unknown as typeof fetch;

    const result = await exchangeWorkspaceCode(TEST_ENV, "code", "verifier");
    expect(result).toEqual({ ok: false, error: "invalid_token_response" });
  });

  it("exchangeWorkspaceCode rejects a non-positive expires_in", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        access_token: "at",
        refresh_token: "rt",
        scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
        expires_in: 0,
        token_type: "Bearer",
      }),
    ) as unknown as typeof fetch;

    const result = await exchangeWorkspaceCode(TEST_ENV, "code", "verifier");
    expect(result.ok).toBe(false);
  });

  it("refreshWorkspaceAccessToken rejects a malformed 2xx response instead of returning it as ok", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({})) as unknown as typeof fetch;

    const result = await refreshWorkspaceAccessToken(TEST_ENV, "refresh-token");
    expect(result).toEqual({ ok: false, error: "invalid_token_response" });
  });
});
