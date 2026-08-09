import { CHAPTERS_SCOPE } from "@gdgjp/gdg-lib/auth/claims";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LinkAccountDeps,
  type LinkRedis,
  OAUTH_SCOPES,
  REDIRECT_URI,
  codeChallengeS256,
  completeAccountLink,
  createLinkAuthorizationUrl,
  getLinkedToken,
  handleAuthCallback,
  unlinkAccount,
} from "./link-account";
import { linkUserKey } from "./redis";
import { decryptToken, encryptToken, parseTokenEncryptionKeys } from "./token-crypto";

function keyB64(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return Buffer.from(bytes).toString("base64");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createMemoryRedis(): LinkRedis & {
  store: Map<string, string>;
  getdelCalls: string[];
} {
  const store = new Map<string, string>();
  const getdelCalls: string[] = [];
  return {
    store,
    getdelCalls,
    async set(key, value, _mode, _ttl) {
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async getdel(key) {
      getdelCalls.push(key);
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    async compareAndSet(key, expected, value, _ttl) {
      if (store.get(key) !== expected) return false;
      store.set(key, value);
      return true;
    },
    async compareAndDelete(key, expected) {
      if (store.get(key) !== expected) return false;
      store.delete(key);
      return true;
    },
  };
}

describe("link-account", () => {
  const keyring = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1), "2": keyB64(2) }));
  // Force current encrypt version to 1 for initial writes in some tests by
  // using a v1-only keyring; rotation tests use the full map.
  const keyringV1 = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1) }));

  let redis: ReturnType<typeof createMemoryRedis>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let now: number;

  const env = {
    IDP_CLIENT_ID: "agents",
    IDP_CLIENT_SECRET: "test-secret",
    ACCOUNTS_URL: "https://accounts.gdgs.jp",
    TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "1": keyB64(1), "2": keyB64(2) }),
  };

  function deps(overrides: Partial<LinkAccountDeps> = {}): LinkAccountDeps {
    return {
      env,
      redis,
      fetch: fetchMock as unknown as typeof fetch,
      nowSeconds: () => now,
      keyring,
      ...overrides,
    };
  }

  beforeEach(() => {
    redis = createMemoryRedis();
    now = 1_700_000_000;
    fetchMock = vi.fn(async () => {
      throw new Error("unexpected fetch");
    });
  });

  function tokenEndpoint(url: string): boolean {
    return url === "https://accounts.gdgs.jp/api/auth/oauth2/token";
  }

  function revokeEndpoint(url: string): boolean {
    return url === "https://accounts.gdgs.jp/api/auth/oauth2/revoke";
  }

  function userInfoEndpoint(url: string): boolean {
    return url === "https://accounts.gdgs.jp/api/auth/oauth2/userinfo";
  }

  async function createStoredLink(
    chatUserId: string,
    tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  ): Promise<void> {
    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_in: tokens.expiresIn,
        });
      }
      if (userInfoEndpoint(input)) return Response.json({ sub: `sub-${chatUserId}` });
      throw new Error(`unexpected fetch: ${input}`);
    });
    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;
    const result = await completeAccountLink(
      { code: `code-${chatUserId}`, state },
      deps({ keyring: keyringV1 }),
    );
    expect(result.ok).toBe(true);
  }

  it("builds an authorization URL with S256 PKCE, offline_access, and chapters scope", async () => {
    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "user-1", spaceId: "spaces/abc" },
      deps(),
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://accounts.gdgs.jp/api/auth/oauth2/authorize",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("agents");
    expect(parsed.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")?.split(" ").sort()).toEqual([...OAUTH_SCOPES].sort());
    expect(parsed.searchParams.get("scope")).toContain("offline_access");
    expect(parsed.searchParams.get("scope")).toContain(CHAPTERS_SCOPE);

    const state = parsed.searchParams.get("state");
    expect(state).toBeTruthy();
    const stored = redis.store.get(`link:state:${state}`);
    expect(stored).toBeTruthy();
    const record = JSON.parse(stored as string) as {
      codeVerifier: string;
      chatUserId: string;
      platform: string;
    };
    expect(record.chatUserId).toBe("user-1");
    expect(record.platform).toBe("google-chat");
    const expectedChallenge = await codeChallengeS256(record.codeVerifier);
    expect(parsed.searchParams.get("code_challenge")).toBe(expectedChallenge);
  });

  it("keys link records by (platform, chatUserId) so Discord and Google Chat do not collide", async () => {
    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: "access-a",
          refresh_token: "refresh-a",
          expires_in: 3600,
        });
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-a" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const urlGchat = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "same-id" },
      deps({ keyring: keyringV1 }),
    );
    const stateGchat = new URL(urlGchat).searchParams.get("state") as string;

    await completeAccountLink(
      { code: "code-gchat", state: stateGchat },
      deps({ keyring: keyringV1 }),
    );

    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: "access-discord",
          refresh_token: "refresh-discord",
          expires_in: 3600,
        });
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-discord" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const urlDiscord = await createLinkAuthorizationUrl(
      { platform: "discord", chatUserId: "same-id" },
      deps({ keyring: keyringV1 }),
    );
    const stateDiscord = new URL(urlDiscord).searchParams.get("state") as string;
    await completeAccountLink(
      { code: "code-discord", state: stateDiscord },
      deps({ keyring: keyringV1 }),
    );

    expect(redis.store.has(linkUserKey("google-chat", "same-id"))).toBe(true);
    expect(redis.store.has(linkUserKey("discord", "same-id"))).toBe(true);
    expect(redis.store.get(linkUserKey("google-chat", "same-id"))).not.toBe(
      redis.store.get(linkUserKey("discord", "same-id")),
    );
  });

  it("encrypts access and refresh tokens before serializing a link record", async () => {
    await createStoredLink("encrypted-user", {
      accessToken: "access-plaintext-secret",
      refreshToken: "refresh-plaintext-secret",
      expiresIn: 3600,
    });

    const serialized = redis.store.get(linkUserKey("google-chat", "encrypted-user")) as string;
    expect(serialized).not.toContain("access-plaintext-secret");
    expect(serialized).not.toContain("refresh-plaintext-secret");

    const stored = JSON.parse(serialized) as {
      accessToken: { keyVersion: number; ciphertext: string };
      refreshToken: { keyVersion: number; ciphertext: string };
    };
    expect(await decryptToken(stored.accessToken, keyringV1)).toBe("access-plaintext-secret");
    expect(await decryptToken(stored.refreshToken, keyringV1)).toBe("refresh-plaintext-secret");

    const token = await getLinkedToken(
      "google-chat",
      "encrypted-user",
      deps({ keyring: keyringV1 }),
    );
    expect(token).toEqual({ status: "ok", accessToken: "access-plaintext-secret" });
  });

  it("rejects unknown state with 400 and performs no token exchange", async () => {
    const result = await completeAccountLink({ code: "code-1", state: "unknown-state" }, deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a replayed (already-consumed) state with no token exchange", async () => {
    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
        });
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-1" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "user-replay" },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;

    const first = await completeAccountLink(
      { code: "code-1", state },
      deps({ keyring: keyringV1 }),
    );
    expect(first.ok).toBe(true);
    const exchangeCalls = fetchMock.mock.calls.filter(([u]) => tokenEndpoint(String(u)));
    expect(exchangeCalls).toHaveLength(1);

    fetchMock.mockClear();
    const second = await completeAccountLink(
      { code: "code-1", state },
      deps({ keyring: keyringV1 }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the link to chatUserId from stored state, ignoring callback query chatUserId", async () => {
    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: "access-bound",
          refresh_token: "refresh-bound",
          expires_in: 3600,
        });
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-bound" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const url = await createLinkAuthorizationUrl(
      { platform: "discord", chatUserId: "real-user" },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;

    // Simulate a hostile callback that also carries chatUserId — completeAccountLink
    // only accepts code/state; the route ignores other query params.
    const result = await completeAccountLink(
      { code: "auth-code", state },
      deps({ keyring: keyringV1 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chatUserId).toBe("real-user");
      expect(result.platform).toBe("discord");
    }
    expect(redis.store.has(linkUserKey("discord", "real-user"))).toBe(true);
    expect(redis.store.has(linkUserKey("discord", "attacker-id"))).toBe(false);
  });

  it("callback route returns 400 for unknown state and never exchanges the code", async () => {
    const request = new Request(
      "https://agent.gdgs.jp/auth/callback?code=leaked-code&state=gone&chatUserId=attacker",
    );
    const response = await handleAuthCallback(request, deps());
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("callback route ignores a conflicting chatUserId query param", async () => {
    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: "access-cb",
          refresh_token: "refresh-cb",
          expires_in: 3600,
        });
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-cb" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "legit-user" },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;
    const request = new Request(
      `https://agent.gdgs.jp/auth/callback?code=auth-code&state=${encodeURIComponent(state)}&chatUserId=attacker-id&platform=discord`,
    );
    const response = await handleAuthCallback(request, deps({ keyring: keyringV1 }));
    expect(response.status).toBe(200);
    expect(redis.store.has(linkUserKey("google-chat", "legit-user"))).toBe(true);
    expect(redis.store.has(linkUserKey("google-chat", "attacker-id"))).toBe(false);
    expect(redis.store.has(linkUserKey("discord", "attacker-id"))).toBe(false);
  });

  it("callback route rejects a replayed URL with 400", async () => {
    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: "access-rp",
          refresh_token: "refresh-rp",
          expires_in: 3600,
        });
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-rp" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "replay-cb" },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;
    const callbackUrl = `https://agent.gdgs.jp/auth/callback?code=auth-code&state=${encodeURIComponent(state)}`;

    const first = await handleAuthCallback(new Request(callbackUrl), deps({ keyring: keyringV1 }));
    expect(first.status).toBe(200);

    fetchMock.mockClear();
    const second = await handleAuthCallback(new Request(callbackUrl), deps({ keyring: keyringV1 }));
    expect(second.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    // Original link remains.
    expect(redis.store.has(linkUserKey("google-chat", "replay-cb"))).toBe(true);
  });

  it("refreshes when under 60s remain and never returns an expired token", async () => {
    fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (tokenEndpoint(input)) {
        const body = String(init?.body ?? "");
        if (body.includes("grant_type=authorization_code")) {
          return Response.json({
            access_token: "access-old",
            refresh_token: "refresh-old",
            expires_in: 30,
          });
        }
        if (body.includes("grant_type=refresh_token")) {
          return Response.json({
            access_token: "access-new",
            refresh_token: "refresh-new",
            expires_in: 3600,
          });
        }
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-1" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "skew-user" },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;
    await completeAccountLink({ code: "c", state }, deps({ keyring: keyringV1 }));

    // Access token expires in 30s from link time; skew is 60s → must refresh.
    const token = await getLinkedToken("google-chat", "skew-user", deps({ keyring }));
    expect(token.status).toBe("ok");
    if (token.status === "ok") {
      expect(token.accessToken).toBe("access-new");
    }

    const serialized = redis.store.get(linkUserKey("google-chat", "skew-user")) as string;
    const stored = JSON.parse(serialized) as {
      refreshToken: { keyVersion: number; ciphertext: string };
      accessToken: { keyVersion: number; ciphertext: string };
    };
    // Lazy re-encrypt both tokens under current (v2) keyring on refresh.
    expect(stored.refreshToken.keyVersion).toBe(2);
    expect(stored.accessToken.keyVersion).toBe(2);
    expect(serialized).not.toContain("access-new");
    expect(serialized).not.toContain("refresh-new");
    expect(await decryptToken(stored.accessToken, keyring)).toBe("access-new");
    expect(await decryptToken(stored.refreshToken, keyring)).toBe("refresh-new");
  });

  it("on invalid_grant deletes the link and returns a linking URL", async () => {
    fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (tokenEndpoint(input)) {
        const body = String(init?.body ?? "");
        if (body.includes("grant_type=authorization_code")) {
          return Response.json({
            access_token: "access-old",
            refresh_token: "refresh-old",
            expires_in: 1,
          });
        }
        if (body.includes("grant_type=refresh_token")) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-1" });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "revoked-user" },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;
    await completeAccountLink({ code: "c", state }, deps({ keyring: keyringV1 }));

    const result = await getLinkedToken("google-chat", "revoked-user", deps({ keyring }));
    expect(result.status).toBe("needs_link");
    if (result.status === "needs_link") {
      expect(result.authorizationUrl).toContain("/api/auth/oauth2/authorize");
      expect(result.authorizationUrl).toContain("code_challenge_method=S256");
    }
    expect(redis.store.has(linkUserKey("google-chat", "revoked-user"))).toBe(false);

    // Only one refresh attempt — no retry loop.
    const refreshCalls = fetchMock.mock.calls.filter(([u, init]) => {
      return tokenEndpoint(String(u)) && String(init?.body ?? "").includes("refresh_token");
    });
    expect(refreshCalls).toHaveLength(1);
  });

  it.each([
    {
      name: "network error",
      response: () => Promise.reject(new Error("network unavailable")),
    },
    {
      name: "IdP 5xx",
      response: () => Promise.resolve(Response.json({ error: "server_error" }, { status: 503 })),
    },
    {
      name: "malformed response",
      response: () => Promise.resolve(new Response("not-json", { status: 502 })),
    },
    {
      name: "missing access token",
      response: () => Promise.resolve(Response.json({ expires_in: 3600 })),
    },
    {
      name: "malformed rotated refresh token",
      response: () =>
        Promise.resolve(
          Response.json({ access_token: "access-new", refresh_token: 123, expires_in: 3600 }),
        ),
    },
  ])("preserves the link on transient refresh failure: $name", async ({ response }) => {
    await createStoredLink("transient-user", {
      accessToken: "access-expiring",
      refreshToken: "refresh-valid",
      expiresIn: 1,
    });
    const key = linkUserKey("google-chat", "transient-user");
    const before = redis.store.get(key);
    fetchMock = vi.fn(async () => response());

    const result = await getLinkedToken("google-chat", "transient-user", deps({ keyring }));

    expect(result).toEqual({ status: "temporarily_unavailable" });
    expect(redis.store.get(key)).toBe(before);
  });

  it("preserves the record when a stored token cannot be decrypted", async () => {
    await createStoredLink("decrypt-failure", {
      accessToken: "access-expiring",
      refreshToken: "refresh-valid",
      expiresIn: 1,
    });
    const key = linkUserKey("google-chat", "decrypt-failure");
    const parsed = JSON.parse(redis.store.get(key) as string) as {
      refreshToken: { keyVersion: number; ciphertext: string };
    };
    parsed.refreshToken.ciphertext = "invalid.ciphertext";
    const corrupted = JSON.stringify(parsed);
    redis.store.set(key, corrupted);
    fetchMock = vi.fn(async () => {
      throw new Error("refresh must not be called");
    });

    const result = await getLinkedToken("google-chat", "decrypt-failure", deps({ keyring }));

    expect(result).toEqual({ status: "temporarily_unavailable" });
    expect(redis.store.get(key)).toBe(corrupted);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serializes concurrent refresh callers and shares the successful winner", async () => {
    await createStoredLink("concurrent-success", {
      accessToken: "access-old",
      refreshToken: "refresh-old",
      expiresIn: 1,
    });
    const refreshStarted = deferred<void>();
    const releaseRefresh = deferred<void>();
    let refreshCalls = 0;
    fetchMock = vi.fn(async (input: string) => {
      if (!tokenEndpoint(input)) throw new Error(`unexpected fetch: ${input}`);
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json({
        access_token: "access-winner",
        refresh_token: "refresh-winner",
        expires_in: 3600,
      });
    });

    const first = getLinkedToken("google-chat", "concurrent-success", deps({ keyring }));
    await refreshStarted.promise;
    const second = getLinkedToken("google-chat", "concurrent-success", deps({ keyring }));
    releaseRefresh.resolve();

    await expect(first).resolves.toEqual({ status: "ok", accessToken: "access-winner" });
    await expect(second).resolves.toEqual({ status: "ok", accessToken: "access-winner" });
    expect(refreshCalls).toBe(1);
  });

  it("an invalid_grant loser recovers a concurrently rotated winner", async () => {
    await createStoredLink("concurrent-invalid", {
      accessToken: "access-old",
      refreshToken: "refresh-old",
      expiresIn: 1,
    });
    const key = linkUserKey("google-chat", "concurrent-invalid");
    const refreshStarted = deferred<void>();
    const releaseRefresh = deferred<void>();
    fetchMock = vi.fn(async (input: string) => {
      if (!tokenEndpoint(input)) throw new Error(`unexpected fetch: ${input}`);
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    });

    const loser = getLinkedToken("google-chat", "concurrent-invalid", deps({ keyring }));
    await refreshStarted.promise;
    const claimed = JSON.parse(redis.store.get(key) as string) as Record<string, unknown>;
    const winner = JSON.stringify({
      ...claimed,
      accessToken: await encryptToken("access-winner", keyring),
      accessTokenExpiresAt: now + 3600,
      refreshToken: await encryptToken("refresh-winner", keyring),
      refreshLease: undefined,
    });
    redis.store.set(key, winner);
    releaseRefresh.resolve();

    await expect(loser).resolves.toEqual({ status: "ok", accessToken: "access-winner" });
    expect(redis.store.get(key)).toBe(winner);
  });

  it("unlink deletes the record and calls the accounts revocation endpoint", async () => {
    fetchMock = vi.fn(async (input: string) => {
      if (tokenEndpoint(input)) {
        return Response.json({
          access_token: "access-u",
          refresh_token: "refresh-u",
          expires_in: 3600,
        });
      }
      if (userInfoEndpoint(input)) {
        return Response.json({ sub: "sub-u" });
      }
      if (revokeEndpoint(input)) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const url = await createLinkAuthorizationUrl(
      { platform: "discord", chatUserId: "unlink-me" },
      deps({ keyring: keyringV1 }),
    );
    const state = new URL(url).searchParams.get("state") as string;
    await completeAccountLink({ code: "c", state }, deps({ keyring: keyringV1 }));
    expect(redis.store.has(linkUserKey("discord", "unlink-me"))).toBe(true);

    const result = await unlinkAccount("discord", "unlink-me", deps({ keyring: keyringV1 }));
    expect(result.revoked).toBe(true);
    expect(redis.store.has(linkUserKey("discord", "unlink-me"))).toBe(false);

    const revokeCalls = fetchMock.mock.calls.filter(([u]) => revokeEndpoint(String(u)));
    expect(revokeCalls).toHaveLength(1);
    const revokeInit = revokeCalls[0]?.[1] as RequestInit;
    expect(String(revokeInit.body)).toContain("token=");
    expect(String(revokeInit.body)).toContain("token_type_hint=refresh_token");
    // Authorization uses client_secret_basic — do not assert secret contents in logs.
    expect(
      String(revokeInit.headers && (revokeInit.headers as Record<string, string>).Authorization),
    ).toMatch(/^Basic /);
  });

  it.each([
    {
      name: "network failure",
      revoke: () => Promise.reject(new Error("network unavailable")),
    },
    {
      name: "non-success response",
      revoke: () => Promise.resolve(new Response(null, { status: 503 })),
    },
  ])("failed unlink preserves retryable encrypted material: $name", async ({ revoke }) => {
    await createStoredLink("unlink-retry", {
      accessToken: "access-u",
      refreshToken: "refresh-u",
      expiresIn: 3600,
    });
    const key = linkUserKey("google-chat", "unlink-retry");
    const before = redis.store.get(key);
    fetchMock = vi.fn(async () => revoke());

    const result = await unlinkAccount("google-chat", "unlink-retry", deps({ keyring }));

    expect(result).toEqual({ revoked: false });
    expect(redis.store.get(key)).toBe(before);
  });

  it("unlink does not delete a concurrently replaced record", async () => {
    await createStoredLink("unlink-race", {
      accessToken: "access-old",
      refreshToken: "refresh-old",
      expiresIn: 3600,
    });
    const key = linkUserKey("google-chat", "unlink-race");
    const replacement = JSON.stringify({
      platform: "google-chat",
      chatUserId: "unlink-race",
      accessToken: await encryptToken("access-new", keyring),
      accessTokenExpiresAt: now + 3600,
      refreshToken: await encryptToken("refresh-new", keyring),
      subject: "sub-new",
      linkedAt: now,
    });
    fetchMock = vi.fn(async (input: string) => {
      if (!revokeEndpoint(input)) throw new Error(`unexpected fetch: ${input}`);
      redis.store.set(key, replacement);
      return new Response(null, { status: 200 });
    });

    const result = await unlinkAccount("google-chat", "unlink-race", deps({ keyring }));

    expect(result).toEqual({ revoked: false });
    expect(redis.store.get(key)).toBe(replacement);
  });

  it("does not leak code, state, verifier, or tokens in error messages", async () => {
    const sensitive = ["auth-code-SECRET", "state-SECRET", "verifier-SECRET", "token-SECRET"];
    fetchMock = vi.fn(async () =>
      Response.json({ error: "invalid_grant", error_description: "nope" }, { status: 400 }),
    );

    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "safe-log" },
      deps({ keyring: keyringV1 }),
    );
    // Force an exchange failure path with a real stored state.
    const state = new URL(url).searchParams.get("state") as string;
    const result = await completeAccountLink(
      { code: "auth-code-SECRET", state },
      deps({ keyring: keyringV1 }),
    );
    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result);
    for (const value of sensitive) {
      expect(serialized).not.toContain(value);
    }
  });
});
