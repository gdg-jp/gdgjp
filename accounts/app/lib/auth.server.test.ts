import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const betterAuthMock = vi.hoisted(() => {
  let options: Record<string, unknown> | undefined;
  let instanceSeq = 0;
  const handler = vi.fn(async () => new Response("ok"));
  const getSession = vi.fn(async () => null);

  function createInstance() {
    instanceSeq += 1;
    return {
      id: instanceSeq,
      handler,
      api: { getSession },
      $context: Promise.resolve({}),
    };
  }

  const betterAuth = vi.fn((_options: Record<string, unknown>) => {
    options = _options;
    return createInstance();
  });

  return {
    betterAuth,
    handler,
    getSession,
    getOptions: () => options,
    reset() {
      options = undefined;
      instanceSeq = 0;
      handler.mockReset();
      handler.mockImplementation(async () => new Response("ok"));
      getSession.mockReset();
      getSession.mockImplementation(async () => null);
      betterAuth.mockClear();
    },
  };
});

vi.mock("better-auth", () => ({
  betterAuth: betterAuthMock.betterAuth,
}));

vi.mock("better-auth/plugins", () => ({
  jwt: () => ({}),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: () => ({}),
}));

vi.mock("./db", () => ({
  listActiveChaptersForUser: vi.fn(async () => []),
}));

import {
  AUTH_HANDLER_TIMEOUT_MS,
  AUTH_IP_ADDRESS_HEADERS,
  OAUTH_STATE_STORAGE,
  SESSION_LOOKUP_TIMEOUT_MS,
  SessionLookupTimeoutError,
  authUnavailableResponse,
  getAuth,
  getSessionUser,
  invalidateAuthCache,
  runAuthHandler,
  withTimeout,
} from "./auth.server";

function testEnv(): Env {
  return {
    APP_URL: "https://accounts.example",
    BETTER_AUTH_SECRET: "test-secret",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    DB: {} as D1Database,
    TINYURL_CLIENT_ID: "tinyurl",
    WIKI_CLIENT_ID: "wiki",
    IMG_CLIENT_ID: "img",
    SCHEDULER_CLIENT_ID: "scheduler",
    SNS_CLIENT_ID: "sns",
    AGENTS_CLIENT_ID: "agents",
  } as unknown as Env;
}

describe("accounts auth", () => {
  beforeEach(() => {
    betterAuthMock.reset();
    invalidateAuthCache();
  });

  afterEach(() => {
    invalidateAuthCache();
    vi.useRealTimers();
  });

  it("keeps Google OAuth transaction state out of D1", () => {
    expect(OAUTH_STATE_STORAGE).toBe("cookie");
  });

  it("does not let a stalled session lookup wait forever", async () => {
    await expect(withTimeout(new Promise<never>(() => undefined), 1)).rejects.toBeInstanceOf(
      SessionLookupTimeoutError,
    );
  });

  it("preserves a session lookup result that arrives before its deadline", async () => {
    await expect(withTimeout(Promise.resolve("session"), 1_000)).resolves.toBe("session");
  });

  it("keys the rate limiter on Cloudflare's connecting IP", () => {
    getAuth(testEnv());
    const advanced = betterAuthMock.getOptions()?.advanced as {
      ipAddress?: { ipAddressHeaders?: string[] };
    };
    expect(advanced.ipAddress?.ipAddressHeaders).toEqual([...AUTH_IP_ADDRESS_HEADERS]);
  });

  it("invalidates the auth cache when a session lookup times out", async () => {
    vi.useFakeTimers();
    betterAuthMock.getSession.mockImplementation(() => new Promise(() => undefined));
    const env = testEnv();
    const first = getAuth(env);

    const lookup = getSessionUser(env, new Request("https://accounts.example/"));
    await vi.advanceTimersByTimeAsync(SESSION_LOOKUP_TIMEOUT_MS);
    await expect(lookup).resolves.toBeNull();

    const second = getAuth(env);
    expect(second).not.toBe(first);
    expect(betterAuthMock.betterAuth).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("returns a 503 fallback when auth.handler never settles", async () => {
    vi.useFakeTimers();
    betterAuthMock.handler.mockImplementation(() => new Promise(() => undefined));
    const env = testEnv();
    const first = getAuth(env);

    const pending = runAuthHandler(env, new Request("https://accounts.example/api/auth/ok"), () =>
      authUnavailableResponse(),
    );
    await vi.advanceTimersByTimeAsync(AUTH_HANDLER_TIMEOUT_MS);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(getAuth(env)).not.toBe(first);
    vi.useRealTimers();
  });

  it("passes through a settled auth.handler response unchanged", async () => {
    const ok = new Response("handler-ok", { status: 200 });
    betterAuthMock.handler.mockResolvedValue(ok);

    const response = await runAuthHandler(
      testEnv(),
      new Request("https://accounts.example/api/auth/ok"),
    );

    expect(response).toBe(ok);
  });
});
