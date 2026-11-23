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

const jwtMock = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
}));

vi.mock("better-auth/plugins", () => ({
  jwt: (options: Record<string, unknown>) => {
    jwtMock.options = options;
    return {};
  },
}));

const oauthProviderMock = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  oauthProvider: vi.fn((options: Record<string, unknown>) => {
    oauthProviderMock.options = options;
    return {};
  }),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: oauthProviderMock.oauthProvider,
}));

const memberships = vi.hoisted(() => ({
  listActiveChaptersForUser: vi.fn(async () => [
    { chapterId: 1, chapterSlug: "tokyo", role: "organizer", chapterName: "Tokyo" },
  ]),
}));

vi.mock("~/features/memberships/repository.server", () => memberships);

import {
  AUTH_HANDLER_TIMEOUT_MS,
  AUTH_IP_ADDRESS_HEADERS,
  CHAPTERS_CLAIM,
  CHAPTERS_SCOPE,
  CLI_SCOPE,
  IS_ADMIN_CLAIM,
  OAUTH_STATE_STORAGE,
  SESSION_LOOKUP_TIMEOUT_MS,
  SessionLookupTimeoutError,
  authUnavailableResponse,
  getAuth,
  getSessionUser,
  invalidateAuthCache,
  requireUser,
  runAuthHandler,
  warmAuth,
  withTimeout,
} from "~/features/auth/auth.server";

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
    oauthProviderMock.options = undefined;
    oauthProviderMock.oauthProvider.mockClear();
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

  it("allows http redirect URIs only on exact loopback hosts", () => {
    getAuth(testEnv());
    const allowInsecure = oauthProviderMock.options?.allowInsecureRedirectUri as
      | ((url: URL) => boolean)
      | undefined;
    expect(allowInsecure).toBeTypeOf("function");
    expect(allowInsecure?.(new URL("http://localhost:5177/api/auth/callback/gdgjp"))).toBe(true);
    expect(allowInsecure?.(new URL("http://127.0.0.1:8787/callback"))).toBe(true);
    expect(allowInsecure?.(new URL("http://[::1]:5177/callback"))).toBe(true);
    expect(allowInsecure?.(new URL("http://evil.example/callback"))).toBe(false);
    expect(allowInsecure?.(new URL("http://localhost.evil.example/callback"))).toBe(false);
  });

  it("denies Better Auth admin OAuth resource management endpoints", () => {
    getAuth(testEnv());
    const resourcePrivileges = oauthProviderMock.options?.resourcePrivileges as
      | ((ctx: unknown) => boolean)
      | undefined;
    expect(resourcePrivileges).toBeTypeOf("function");
    expect(resourcePrivileges?.({ user: { id: "u1", isAdmin: true } })).toBe(false);
  });

  it("advertises the scope and claim names relying parties depend on", () => {
    expect({ CHAPTERS_SCOPE, CLI_SCOPE, CHAPTERS_CLAIM, IS_ADMIN_CLAIM }).toEqual({
      CHAPTERS_SCOPE: "https://gdgs.jp/scopes/chapters",
      CLI_SCOPE: "https://gdgs.jp/scopes/cli",
      CHAPTERS_CLAIM: "https://gdgs.jp/claims/chapters",
      IS_ADMIN_CLAIM: "https://gdgs.jp/claims/is_admin",
    });
  });

  it("configures sessions, Google sign-in, and storage as the provider contract requires", () => {
    getAuth({ ...testEnv(), APP_URL: "https://accounts.example/" } as unknown as Env);
    expect(betterAuthMock.getOptions()).toMatchObject({
      baseURL: "https://accounts.example/",
      basePath: "/api/auth",
      secret: "test-secret",
      advanced: { cookiePrefix: "gdgjp-accounts", database: { generateId: "uuid" } },
      user: {
        fields: {
          emailVerified: "email_verified",
          createdAt: "created_at",
          updatedAt: "updated_at",
        },
        additionalFields: {
          isAdmin: {
            type: "boolean",
            required: false,
            defaultValue: false,
            input: false,
            fieldName: "is_admin",
          },
        },
      },
      session: { expiresIn: 1_209_600, cookieCache: { enabled: false } },
      account: { storeStateStrategy: "cookie" },
      socialProviders: {
        google: {
          clientId: "google-client",
          clientSecret: "google-secret",
          prompt: "select_account",
          redirectURI: "https://accounts.example/oauth/google/callback",
        },
      },
      disabledPaths: ["/token"],
    });
  });

  it("enables only the authorization-code and refresh-token grants with fixed scopes and lifetimes", () => {
    getAuth({ ...testEnv(), PAY_CLIENT_ID: "pay" } as unknown as Env);
    const options = oauthProviderMock.options;
    expect(options).toMatchObject({
      loginPage: "/signin",
      consentPage: "/oauth/consent",
      scopes: ["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE, CLI_SCOPE],
      clientRegistrationDefaultScopes: ["openid"],
      clientRegistrationAllowedScopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        CHAPTERS_SCOPE,
        CLI_SCOPE,
      ],
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      advertisedMetadata: { claims_supported: [CHAPTERS_CLAIM, IS_ADMIN_CLAIM] },
      accessTokenExpiresIn: 3_600,
      refreshTokenExpiresIn: 2_592_000,
      grantTypes: ["authorization_code", "refresh_token"],
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
    });
    expect([...(options?.cachedTrustedClients as Set<string>)]).toEqual([
      "tinyurl",
      "wiki",
      "img",
      "scheduler",
      "sns",
      "agents",
      "pay",
    ]);
  });

  it("lets only active chapter members manage OAuth clients", async () => {
    const lookups: unknown[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(userId: string) {
            lookups.push([sql, userId]);
            return { first: async () => (userId === "member" ? { ok: 1 } : null) };
          },
        };
      },
    };
    getAuth({ ...testEnv(), DB: db } as unknown as Env);
    const clientPrivileges = oauthProviderMock.options?.clientPrivileges as (ctx: {
      user?: { id: string };
    }) => Promise<boolean>;

    await expect(clientPrivileges({})).resolves.toBe(false);
    await expect(clientPrivileges({ user: { id: "member" } })).resolves.toBe(true);
    await expect(clientPrivileges({ user: { id: "former" } })).resolves.toBe(false);
    expect(lookups[0]).toEqual([
      "SELECT 1 AS ok FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1",
      "member",
    ]);
  });

  it("adds chapter and admin claims to UserInfo and ID Tokens only with the chapters scope", async () => {
    const env = testEnv();
    getAuth(env);
    const expected = {
      [CHAPTERS_CLAIM]: [{ chapterId: 1, chapterSlug: "tokyo", role: "organizer" }],
      [IS_ADMIN_CLAIM]: true,
    };
    for (const key of ["customUserInfoClaims", "customIdTokenClaims"]) {
      const claims = oauthProviderMock.options?.[key] as (ctx: {
        user: Record<string, unknown>;
        scopes: string[];
      }) => Promise<Record<string, unknown>>;
      await expect(
        claims({ user: { id: "u1", isAdmin: true }, scopes: ["openid", CHAPTERS_SCOPE] }),
        key,
      ).resolves.toEqual(expected);
      await expect(
        claims({ user: { id: "u1", isAdmin: 1 }, scopes: ["openid", CHAPTERS_SCOPE] }),
        key,
      ).resolves.toMatchObject({ [IS_ADMIN_CLAIM]: false });
      await expect(
        claims({ user: { id: "u1", isAdmin: true }, scopes: ["openid"] }),
        key,
      ).resolves.toEqual({});
    }
    expect(memberships.listActiveChaptersForUser).toHaveBeenCalledWith(env.DB, "u1");
  });

  it("maps the Better Auth session user and requires one for protected loaders", async () => {
    betterAuthMock.getSession.mockResolvedValueOnce({
      user: { id: "u1", email: "a@example.com", name: "A", image: undefined, isAdmin: 1 },
    } as never);
    await expect(
      getSessionUser(testEnv(), new Request("https://accounts.example/")),
    ).resolves.toEqual({
      id: "u1",
      email: "a@example.com",
      name: "A",
      image: null,
      isAdmin: false,
    });

    const rejected = await requireUser(testEnv(), new Request("https://accounts.example/")).catch(
      (error: unknown) => error,
    );
    expect(rejected).toBeInstanceOf(Response);
    expect((rejected as Response).status).toBe(401);
    expect(await (rejected as Response).text()).toBe("Unauthorized");
  });

  it("signs RS256 ID Tokens for the issuer without a trailing slash", () => {
    for (const appUrl of ["https://accounts.example", "https://accounts.example/"]) {
      getAuth({ ...testEnv(), APP_URL: appUrl } as unknown as Env);
      expect(jwtMock.options, appUrl).toEqual({
        jwks: {
          keyPairConfig: { alg: "RS256", modulusLength: 2048 },
          rotationInterval: 2_592_000,
          gracePeriod: 2_592_000,
        },
        jwt: { issuer: "https://accounts.example" },
        disableSettingJwtHeader: true,
      });
      invalidateAuthCache();
    }
  });

  it("passes request headers to Better Auth and rethrows lookup failures other than timeouts", async () => {
    const request = new Request("https://accounts.example/", { headers: { cookie: "a=1" } });
    betterAuthMock.getSession.mockResolvedValueOnce({
      user: { id: "u1", email: "a@example.com", name: "A", image: "https://img", isAdmin: true },
    } as never);
    await expect(getSessionUser(testEnv(), request)).resolves.toMatchObject({
      image: "https://img",
      isAdmin: true,
    });
    expect(betterAuthMock.getSession).toHaveBeenCalledWith({ headers: request.headers });

    betterAuthMock.getSession.mockRejectedValueOnce(new Error("D1 unavailable"));
    await expect(
      getSessionUser(testEnv(), new Request("https://accounts.example/")),
    ).rejects.toThrow("D1 unavailable");

    betterAuthMock.handler.mockRejectedValueOnce(new Error("handler crashed"));
    await expect(
      runAuthHandler(testEnv(), new Request("https://accounts.example/api/auth/ok")),
    ).rejects.toThrow("handler crashed");
  });

  it("clears the deadline timer once the operation settles", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("done"), 1_000)).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("warms the auth context without surfacing its failure", async () => {
    await expect(warmAuth(testEnv())).resolves.toBeUndefined();
    invalidateAuthCache();
    betterAuthMock.betterAuth.mockReturnValueOnce({
      id: 0,
      handler: betterAuthMock.handler,
      api: { getSession: betterAuthMock.getSession },
      $context: Promise.reject(new Error("migrations failed")),
    } as never);
    await expect(warmAuth(testEnv())).resolves.toBeUndefined();
  });

  it("reuses the auth instance for the same environment and memoizes lookups per request", async () => {
    const env = testEnv();
    expect(getAuth(env)).toBe(getAuth(env));
    const request = new Request("https://accounts.example/");
    await Promise.all([getSessionUser(env, request), getSessionUser(env, request)]);
    expect(betterAuthMock.getSession).toHaveBeenCalledTimes(1);
  });

  it("states the session lookup deadline in its timeout error", async () => {
    expect(new SessionLookupTimeoutError(5)).toMatchObject({
      name: "SessionLookupTimeoutError",
      message: "Session lookup exceeded 5ms",
    });
    const unavailable = authUnavailableResponse();
    expect(unavailable.headers.get("Retry-After")).toBe("5");
    expect(await unavailable.text()).toBe("Service Temporarily Unavailable");
  });
});
