import type { D1Database } from "@cloudflare/workers-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signPayload, verifyPayload } from "./cookie";
import { CHAPTERS_CLAIM, CHAPTERS_SCOPE, IS_ADMIN_CLAIM } from "./index";

const oidc = vi.hoisted(() => ({
  discovery: vi.fn(),
  randomPKCECodeVerifier: vi.fn(() => "verifier"),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
  randomState: vi.fn(() => "state"),
  randomNonce: vi.fn(() => "nonce"),
  buildAuthorizationUrl: vi.fn((_config, parameters: Record<string, string>) => {
    const url = new URL("https://issuer.example/authorize");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url;
  }),
  authorizationCodeGrant: vi.fn(),
  fetchUserInfo: vi.fn(),
  refreshTokenGrant: vi.fn(),
  buildEndSessionUrl: vi.fn((_config, parameters: Record<string, string>) => {
    const url = new URL("https://issuer.example/logout");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url;
  }),
  ClientSecretBasic: vi.fn((secret: string) => ({ basic: secret })),
  allowInsecureRequests: Symbol("allowInsecureRequests"),
  customFetch: Symbol("customFetch"),
}));

vi.mock("openid-client", () => oidc);

import { initializeRpAuth } from "./rp";

const secret = "test-secret";
const NOW = Date.UTC(2026, 0, 1);

function configuration(issuer = "https://issuer.example") {
  return {
    serverMetadata: () => ({ issuer, end_session_endpoint: `${issuer}/logout` }),
  };
}

interface StoredTokenSession {
  id: string;
  userId: string;
  issuer: string;
  subject: string;
  accessToken: string;
  refreshToken: string | null;
  idToken: string;
  accessTokenExpiresAt: number;
  expiresAt: number;
}

function database(options?: {
  linked?: { id: string } | null;
  byEmail?: { id: string; oidc_issuer: string | null; oidc_subject: string | null } | null;
  tokenSession?: StoredTokenSession | null;
  tokenReads?: Array<StoredTokenSession | null>;
  changes?: number;
  failRun?: (sql: string) => boolean;
}) {
  const calls: Array<{ sql: string; args: unknown[]; operation: "first" | "run" }> = [];
  let tokenSession = options?.tokenSession ?? null;
  const tokenReads = options?.tokenReads ? [...options.tokenReads] : null;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          args = values;
          return this;
        },
        async first() {
          calls.push({ sql, args, operation: "first" });
          if (sql.includes("FROM oidc_session")) {
            return tokenReads ? (tokenReads.shift() ?? null) : tokenSession;
          }
          if (sql.includes("oidc_issuer = ?")) {
            return options && "linked" in options ? options.linked : { id: "local-user" };
          }
          if (sql.includes("WHERE email = ?")) {
            return options && "byEmail" in options ? options.byEmail : null;
          }
          return null;
        },
        async run() {
          calls.push({ sql, args, operation: "run" });
          if (options?.failRun?.(sql)) throw new Error("D1 unavailable");
          if (sql.includes("INSERT INTO oidc_session")) {
            tokenSession = {
              id: args[0] as string,
              userId: args[1] as string,
              issuer: args[2] as string,
              subject: args[3] as string,
              accessToken: args[4] as string,
              refreshToken: args[5] as string | null,
              idToken: args[6] as string,
              accessTokenExpiresAt: args[7] as number,
              expiresAt: args[8] as number,
            };
          } else if (sql.includes("UPDATE oidc_session") && tokenSession) {
            tokenSession = {
              ...tokenSession,
              accessToken: args[0] as string,
              refreshToken: args[1] as string | null,
              idToken: args[2] as string,
              accessTokenExpiresAt: args[3] as number,
            };
          } else if (sql.includes("DELETE FROM oidc_session")) {
            tokenSession = null;
          }
          return { meta: { changes: options?.changes ?? 1 } };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

function sessionCheck(body: Record<string, unknown> = { active: true, ...userInfo() }) {
  return vi.fn<typeof fetch>(async () => Response.json(body));
}

function auth(
  db: D1Database,
  issuer = "https://issuer.example",
  idpFetch: typeof fetch = sessionCheck(),
  appUrl = "https://app.example",
) {
  return initializeRpAuth({
    db,
    appUrl,
    cookiePrefix: "app",
    secret,
    idp: { url: issuer, clientId: "client", clientSecret: "client-secret", fetch: idpFetch },
  });
}

async function sessionCookie(overrides: Record<string, unknown> = {}) {
  const value = await signPayload(
    {
      version: 4,
      sessionId: "session-1",
      userId: "local-user",
      issuer: "https://issuer.example",
      subject: "subject-1",
      sid: "idp-session-1",
      expiresAt: Date.now() + 60_000,
      ...overrides,
    },
    secret,
  );
  return `app-session=${value}`;
}

function page(cookie: string, url = "https://app.example/") {
  return new Request(url, { headers: { Cookie: cookie } });
}

async function transactionCookie() {
  const value = await signPayload(
    {
      codeVerifier: "verifier",
      state: "state",
      nonce: "nonce",
      returnTo: "https://app.example/after",
      exp: Date.now() + 60_000,
    },
    secret,
  );
  return `app-oidc-tx=${value}; gdg_sid=idp-session-1`;
}

function tokenResponse(idToken = "signed-id-token") {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    id_token: idToken,
    claims: () => ({ sub: "subject-1", sid: "idp-session-1" }),
  };
}

function userInfo(emailVerified = true) {
  return {
    sub: "subject-1",
    email: "user@example.com",
    email_verified: emailVerified,
    name: "Example User",
    picture: "https://example.com/user.png",
    [IS_ADMIN_CLAIM]: true,
    [CHAPTERS_CLAIM]: [
      { chapterId: 10, chapterSlug: "tokyo", role: "organizer" },
      { chapterId: 20, chapterSlug: "osaka", role: "member" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  oidc.discovery.mockResolvedValue(configuration());
  oidc.authorizationCodeGrant.mockResolvedValue(tokenResponse());
  oidc.fetchUserInfo.mockResolvedValue(userInfo());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OIDC RP sign-in", () => {
  it("restarts sign-in once when the callback arrives without a transaction cookie", async () => {
    const { db } = database();
    const instance = auth(db);
    const lost = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state"),
    );

    expect(lost.status).toBe(302);
    expect(lost.headers.get("location")).toBe("https://app.example/api/auth/signin?retry=1");
    expect(oidc.authorizationCodeGrant).not.toHaveBeenCalled();

    const retry = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/signin?retry=1"),
    );
    const retryState = new URL(retry.headers.get("location") ?? "").searchParams.get("state");
    expect(retryState).toBe("retry.state");

    const lostAgain = await instance.handleAuthRequest(
      new Request(`https://app.example/api/auth/callback/gdgjp?code=code&state=${retryState}`),
    );
    expect(lostAgain.status).toBe(400);
    expect(await lostAgain.text()).toContain('href="https://app.example/api/auth/signin"');
  });

  it("restarts sign-in when the transaction cookie has expired", async () => {
    const { db } = database();
    const expired = await signPayload(
      { codeVerifier: "verifier", state: "state", nonce: "nonce", returnTo: "/", exp: 0 },
      secret,
    );
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: `app-oidc-tx=${expired}` },
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.example/api/auth/signin?retry=1");
  });

  it("still accepts a transaction cookie in its last millisecond", async () => {
    useFixedTime();
    const { db } = database();
    const tx = await signPayload(
      { codeVerifier: "verifier", state: "state", nonce: "nonce", returnTo: "/", exp: NOW },
      secret,
    );
    await auth(db).handleAuthRequest(callback(`app-oidc-tx=${tx}; gdg_sid=idp-session-1`));
    expect(oidc.authorizationCodeGrant).toHaveBeenCalledOnce();
  });

  it("does not restart sign-in when the IdP returned an error", async () => {
    const { db } = database();
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?error=access_denied&state=state"),
    );

    expect(response.status).toBe(400);
  });

  it("uses a bounded internal transport for every OIDC endpoint", async () => {
    const { db } = database();
    const idpFetch = vi.fn<typeof fetch>();
    await auth(db, "https://service-bound-issuer.example", idpFetch).handleAuthRequest(
      new Request("https://app.example/api/auth/signin"),
    );

    expect(oidc.discovery).toHaveBeenCalledWith(
      new URL("https://service-bound-issuer.example"),
      "client",
      undefined,
      { basic: "client-secret" },
      expect.objectContaining({
        timeout: 10,
        [oidc.customFetch]: idpFetch,
      }),
    );
  });

  it("requires an ID Token, validates nonce, binds UserInfo to its subject and the session to sid", async () => {
    const { db, calls } = database();
    const instance = auth(db);
    const response = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: await transactionCookie() },
      }),
    );

    expect(response.status).toBe(302);
    expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(URL),
      expect.objectContaining({
        pkceCodeVerifier: "verifier",
        expectedState: "state",
        expectedNonce: "nonce",
        idTokenExpected: true,
      }),
    );
    expect(oidc.fetchUserInfo).toHaveBeenCalledWith(expect.anything(), "access-token", "subject-1");
    expect(calls[0]).toEqual(
      expect.objectContaining({ args: ["https://issuer.example", "subject-1"] }),
    );
    expect(calls.some((call) => call.sql.includes("is_admin"))).toBe(false);

    const cookie = response.headers.getSetCookie()[0].split(";")[0];
    const claims = await instance.getFreshClaims(page(`${cookie}; gdg_sid=idp-session-1`));
    expect(claims.isAdmin).toBe(true);
    expect(claims.chapter).toEqual({ chapterId: 10, chapterSlug: "tokyo", role: "organizer" });
    expect(claims.chapters).toHaveLength(2);
  });

  it("refuses an ID Token without a session ID", async () => {
    oidc.authorizationCodeGrant.mockResolvedValue({
      ...tokenResponse(),
      claims: () => ({ sub: "subject-1" }),
    });
    const { db, calls } = database();
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: await transactionCookie() },
      }),
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("stops instead of looping when the browser does not present the IdP session hint", async () => {
    const { db, calls } = database();
    const txOnly = (await transactionCookie()).replace("; gdg_sid=idp-session-1", "");
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: `${txOnly}; gdg_sid=another-session` },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("サインインを完了できませんでした");
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the token endpoint omits the ID Token", async () => {
    oidc.authorizationCodeGrant.mockResolvedValue(tokenResponse(""));
    const { db, calls } = database();
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: await transactionCookie() },
      }),
    );

    expect(response.status).toBe(400);
    expect(oidc.fetchUserInfo).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("only uses verified email for the one-time migration link", async () => {
    oidc.fetchUserInfo.mockResolvedValue(userInfo(false));
    const { db, calls } = database({ linked: null });
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: await transactionCookie() },
      }),
    );

    expect(response.status).toBe(400);
    expect(calls.some((call) => call.operation === "run")).toBe(false);
  });

  it("fails closed when a verified email belongs to another OIDC identity", async () => {
    const { db, calls } = database({
      linked: null,
      byEmail: {
        id: "other-user",
        oidc_issuer: "https://other-issuer.example",
        oidc_subject: "other-subject",
      },
    });
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: await transactionCookie() },
      }),
    );

    expect(response.status).toBe(400);
    expect(calls.some((call) => call.operation === "run")).toBe(false);
  });

  it("repairs a stale subject from a recreated loopback IdP database", async () => {
    oidc.discovery.mockResolvedValue(configuration("http://localhost:5173"));
    const { db, calls } = database({
      linked: null,
      byEmail: {
        id: "local-user",
        oidc_issuer: "http://localhost:5173",
        oidc_subject: "old-subject",
      },
    });
    const response = await auth(db, "http://localhost:5173").handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: await transactionCookie() },
      }),
    );

    expect(response.status).toBe(302);
    expect(calls).toContainEqual(
      expect.objectContaining({
        operation: "run",
        args: expect.arrayContaining([
          "subject-1",
          "local-user",
          "http://localhost:5173",
          "old-subject",
        ]),
      }),
    );
  });

  it("does not repair a stale subject for a non-loopback issuer", async () => {
    const { db, calls } = database({
      linked: null,
      byEmail: {
        id: "other-user",
        oidc_issuer: "https://issuer.example",
        oidc_subject: "old-subject",
      },
    });
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?code=code&state=state", {
        headers: { Cookie: await transactionCookie() },
      }),
    );

    expect(response.status).toBe(400);
    expect(calls.some((call) => call.operation === "run")).toBe(false);
  });
});

describe("OIDC RP session", () => {
  it("asks the IdP on every request and returns its current identity", async () => {
    const idpFetch = sessionCheck({
      active: true,
      ...userInfo(),
      name: "Renamed User",
      [IS_ADMIN_CLAIM]: false,
    });
    const { db, calls } = database();
    const user = await auth(db, undefined, idpFetch).getSessionUser(
      page(`${await sessionCookie()}; gdg_sid=idp-session-1`),
    );

    expect(user).toEqual({
      id: "local-user",
      email: "user@example.com",
      name: "Renamed User",
      image: "https://example.com/user.png",
      isAdmin: false,
    });
    const [url, init] = idpFetch.mock.calls[0];
    expect(url).toBe("https://issuer.example/api/rp/v1/session");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Basic ${btoa("client:client-secret")}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ sid: "idp-session-1", sub: "subject-1" });
    const sync = calls.find((call) => call.sql.includes('UPDATE "user"'));
    expect(sync?.args.slice(0, 2)).toEqual(["Renamed User", "https://example.com/user.png"]);
  });

  it("checks the IdP once per request however many loaders ask", async () => {
    const idpFetch = sessionCheck();
    const { db } = database();
    const instance = auth(db, undefined, idpFetch);
    const request = page(`${await sessionCookie()}; gdg_sid=idp-session-1`);

    await Promise.all([
      instance.getSessionUser(request),
      instance.requireUser(request),
      instance.getFreshClaims(request),
    ]);

    expect(idpFetch).toHaveBeenCalledTimes(1);
  });

  it("is signed out without asking the IdP when the browser's IdP session changed", async () => {
    const idpFetch = sessionCheck();
    const { db } = database();
    const instance = auth(db, undefined, idpFetch);

    expect(
      await instance.getSessionUser(page(`${await sessionCookie()}; gdg_sid=idp-session-2`)),
    ).toBeNull();
    expect(await instance.getSessionUser(page(await sessionCookie()))).toBeNull();
    await expect(instance.getFreshClaims(page(await sessionCookie()))).rejects.toMatchObject({
      name: "ClaimsUnavailableError",
      reason: "no_linked_account",
    });
    expect(idpFetch).not.toHaveBeenCalled();
  });

  it("rejects session cookies that are not a current v4 session for this IdP", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const invalid: Array<[string, Record<string, unknown>]> = [
      [
        "a v3 session from before the IdP binding",
        { version: 3, email: "user@example.com", name: "Example User", isAdmin: true },
      ],
      ["an empty session ID", { sessionId: "" }],
      ["a non-string session ID", { sessionId: ["session-1"] }],
      ["an empty user ID", { userId: "" }],
      ["a non-string user ID", { userId: ["local-user"] }],
      ["another issuer", { issuer: "https://other-issuer.example" }],
      ["an empty subject", { subject: "" }],
      ["a non-string subject", { subject: ["subject-1"] }],
      ["an empty IdP session ID", { sid: "" }],
      ["a non-string IdP session ID", { sid: ["idp-session-1"] }],
      ["an expiry of now", { expiresAt: NOW }],
      ["a non-numeric expiry", { expiresAt: String(NOW + 60_000) }],
    ];
    const idpFetch = sessionCheck();
    const { db } = database();
    const instance = auth(db, undefined, idpFetch);

    for (const [reason, overrides] of invalid) {
      const user = await instance.getSessionUser(
        page(`${await sessionCookie(overrides)}; gdg_sid=idp-session-1`),
      );
      expect(user, reason).toBeNull();
    }
    expect(idpFetch).not.toHaveBeenCalled();

    const valid = await instance.getSessionUser(
      page(`${await sessionCookie({ expiresAt: NOW + 1 })}; gdg_sid=idp-session-1`),
    );
    expect(valid?.id).toBe("local-user");
  });

  it("matches the session issuer against the IdP URL without its trailing slash", async () => {
    const { db } = database();
    const user = await auth(db, "https://issuer.example/").getSessionUser(
      page(`${await sessionCookie()}; gdg_sid=idp-session-1`),
    );
    expect(user?.id).toBe("local-user");
  });

  it("uses RP-Initiated Logout with an ID Token hint", async () => {
    const { db, calls } = database({
      tokenSession: {
        id: "session-1",
        userId: "local-user",
        issuer: "https://issuer.example",
        subject: "subject-1",
        accessToken: "access-token",
        refreshToken: null,
        idToken: "signed-id-token",
        accessTokenExpiresAt: Date.now() + 60_000,
        expiresAt: Date.now() + 60_000,
      },
    });
    const response = await auth(db).handleSignOutRedirect(
      page(await sessionCookie(), "https://app.example/auth/signout"),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://issuer.example/logout");
    expect(location.searchParams.get("id_token_hint")).toBe("signed-id-token");
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://app.example/signin",
    );
    expect(calls.some((call) => call.sql.includes("DELETE FROM oidc_session"))).toBe(true);
  });

  it("persists refresh-token rotation in the server-side session", async () => {
    oidc.refreshTokenGrant.mockResolvedValue({
      access_token: "rotated-access-token",
      refresh_token: "rotated-refresh-token",
      id_token: "rotated-id-token",
      expires_in: 3600,
    });
    const { db, calls } = database({
      tokenSession: {
        id: "session-1",
        userId: "local-user",
        issuer: "https://issuer.example",
        subject: "subject-1",
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        idToken: "signed-id-token",
        accessTokenExpiresAt: Date.now() - 1,
        expiresAt: Date.now() + 60_000,
      },
    });

    const token = await auth(db).getAccessToken(
      page(`${await sessionCookie()}; gdg_sid=idp-session-1`),
    );

    expect(token).toBe("rotated-access-token");
    expect(oidc.refreshTokenGrant).toHaveBeenCalledWith(expect.anything(), "refresh-token");
    const update = calls.find((call) => call.sql.includes("UPDATE oidc_session"));
    expect(update?.args.slice(0, 3)).toEqual([
      "rotated-access-token",
      "rotated-refresh-token",
      "rotated-id-token",
    ]);
  });

  it("does not hand out access tokens once the IdP session has ended", async () => {
    const { db } = database();
    await expect(
      auth(db, undefined, sessionCheck({ active: false })).getAccessToken(
        page(`${await sessionCookie()}; gdg_sid=idp-session-1`),
      ),
    ).rejects.toMatchObject({ name: "ClaimsUnavailableError", reason: "no_linked_account" });
    expect(oidc.refreshTokenGrant).not.toHaveBeenCalled();
  });
});

describe("dev sessions", () => {
  const local = "http://localhost:5199";

  it("mints a signed-in session with the requested chapters on a loopback app", async () => {
    const idpFetch = sessionCheck();
    const { db } = database();
    const instance = auth(db, "http://localhost:5173", idpFetch, local);
    const login = await instance.handleDevLogin(
      new Request(
        `${local}/dev/login?as=owner&chapter=7:kyoto&chapter=8:nara:member&admin=1&return_to=/e/1`,
      ),
    );

    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe(`${local}/e/1`);
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    const claims = await instance.getFreshClaims(page(cookie, `${local}/`));
    expect(claims).toMatchObject({
      sub: "dev-owner",
      isAdmin: true,
      chapter: { chapterId: 7, chapterSlug: "kyoto", role: "organizer" },
      chapters: [
        { chapterId: 7, chapterSlug: "kyoto", role: "organizer" },
        { chapterId: 8, chapterSlug: "nara", role: "member" },
      ],
    });
    expect((await instance.getSessionUser(page(cookie, `${local}/`)))?.id).toBe("dev-user-owner");
    expect(idpFetch).not.toHaveBeenCalled();
  });

  it("supports a member of no chapter", async () => {
    const { db } = database();
    const instance = auth(db, "http://localhost:5173", sessionCheck(), local);
    const login = await instance.handleDevLogin(new Request(`${local}/dev/login?chapter=none`));
    const cookie = login.headers.getSetCookie()[0].split(";")[0];

    expect((await instance.getFreshClaims(page(cookie, `${local}/`))).chapters).toEqual([]);
  });

  it("is unavailable outside loopback and its cookies are ignored there", async () => {
    const { db } = database();
    const login = await auth(db).handleDevLogin(new Request("https://app.example/dev/login"));
    expect(login.status).toBe(404);

    const forged = await sessionCookie({
      dev: { email: "x@dev.local", name: "x", isAdmin: true, chapters: [] },
    });
    const idpFetch = sessionCheck();
    expect(await auth(db, undefined, idpFetch).getSessionUser(page(forged))).toBeNull();
    expect(idpFetch).not.toHaveBeenCalled();
  });
});

function callback(cookie: string, url = "https://app.example/api/auth/callback/gdgjp") {
  return new Request(`${url}?code=code&state=state`, { headers: { Cookie: cookie } });
}

function storedSession(overrides: Partial<StoredTokenSession> = {}): StoredTokenSession {
  return {
    id: "session-1",
    userId: "local-user",
    issuer: "https://issuer.example",
    subject: "subject-1",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    idToken: "signed-id-token",
    accessTokenExpiresAt: NOW + 60_000,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

function useFixedTime() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
}

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));
}

describe("OIDC RP routes", () => {
  it("accepts the callback without the provider suffix", async () => {
    const { db } = database();
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/callback?code=code&state=state"),
    );
    expect(response.headers.get("location")).toBe("https://app.example/api/auth/signin?retry=1");
  });

  it("signs out on both sign-out paths and clears the session cookie", async () => {
    const { db } = database();
    for (const path of ["/api/auth/signout", "/api/auth/sign-out"]) {
      const response = await auth(db).handleAuthRequest(new Request(`https://app.example${path}`));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://app.example/signin");
      expect(response.headers.get("set-cookie")).toMatch(/^app-session=; Max-Age=0;/);
    }
  });

  it("reports the current user without caching", async () => {
    const { db } = database();
    const instance = auth(db);
    const signedIn = await instance.handleAuthRequest(
      page(`${await sessionCookie()}; gdg_sid=idp-session-1`, "https://app.example/api/auth/me"),
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("content-type")).toBe("application/json");
    expect(signedIn.headers.get("cache-control")).toBe("no-store");
    expect(await signedIn.json()).toEqual({
      user: {
        id: "local-user",
        email: "user@example.com",
        name: "Example User",
        image: "https://example.com/user.png",
        isAdmin: true,
      },
    });

    const signedOut = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/me"),
    );
    expect(await signedOut.json()).toEqual({ user: null });
  });

  it("returns 404 for unknown auth paths and 401 from requireUser without a session", async () => {
    const { db } = database();
    const instance = auth(db);
    const missing = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/unknown"),
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not found");

    const rejected = await instance
      .requireUser(new Request("https://app.example/"))
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Response);
    expect((rejected as Response).status).toBe(401);
    expect(await (rejected as Response).text()).toBe("Unauthorized");
  });
});

describe("OIDC RP sign-in request", () => {
  it("binds PKCE, state, nonce, and the return path into a signed, short-lived transaction", async () => {
    useFixedTime();
    const { db } = database();
    const response = await auth(db, undefined, undefined, "https://app.example/").handleAuthRequest(
      new Request("https://app.example/api/auth/signin?return_to=/after"),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(Object.fromEntries(location.searchParams)).toEqual({
      redirect_uri: "https://app.example/api/auth/callback/gdgjp",
      scope: `openid email profile offline_access ${CHAPTERS_SCOPE}`,
      code_challenge: "challenge",
      code_challenge_method: "S256",
      state: "state",
      nonce: "nonce",
    });
    expect(oidc.calculatePKCECodeChallenge).toHaveBeenCalledWith("verifier");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(
      /^app-oidc-tx=[^;]+; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/,
    );
    expect(await verifyPayload(cookieValue(setCookie), secret)).toEqual({
      codeVerifier: "verifier",
      state: "state",
      nonce: "nonce",
      returnTo: "https://app.example/after",
      exp: NOW + 600_000,
    });
  });

  it("only returns to same-origin targets", async () => {
    const { db } = database();
    for (const returnTo of ["https://evil.example/after", "http://[", ""]) {
      const response = await auth(db).handleAuthRequest(
        new Request(
          `https://app.example/api/auth/signin?return_to=${encodeURIComponent(returnTo)}`,
        ),
      );
      const tx = await verifyPayload<{ returnTo: string }>(
        cookieValue(response.headers.get("set-cookie") ?? ""),
        secret,
      );
      expect(tx?.returnTo, returnTo).toBe("https://app.example/");
    }
  });

  it("omits Secure from the transaction cookie only on a loopback app", async () => {
    const { db } = database();
    const response = await auth(
      db,
      "http://localhost:5173",
      undefined,
      "http://localhost:5199",
    ).handleAuthRequest(new Request("http://localhost:5199/api/auth/signin"));
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("allows HTTP discovery only for an HTTP issuer and caches it per issuer", async () => {
    const { db } = database();
    const insecure = vi.fn<typeof fetch>();
    await auth(db, "http://discovery-local.example", insecure).handleAuthRequest(
      new Request("https://app.example/api/auth/signin"),
    );
    expect(oidc.discovery.mock.calls[0][4]).toEqual({
      timeout: 10,
      [oidc.customFetch]: insecure,
      execute: [oidc.allowInsecureRequests],
    });

    const secure = vi.fn<typeof fetch>();
    const instance = auth(db, "https://discovery-cached.example", secure);
    await instance.handleAuthRequest(new Request("https://app.example/api/auth/signin"));
    await instance.handleAuthRequest(new Request("https://app.example/api/auth/signin"));
    expect(oidc.discovery).toHaveBeenCalledTimes(2);
    expect(oidc.discovery.mock.calls[1][4]).toEqual({ timeout: 10, [oidc.customFetch]: secure });
  });

  it("forgets a failed discovery so the next request retries it", async () => {
    const { db } = database();
    const instance = auth(db, "https://discovery-flaky.example");
    oidc.discovery.mockRejectedValueOnce(new Error("unreachable"));
    const failed = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/signin"),
    );
    expect(failed.status).toBe(503);
    const retried = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/signin"),
    );
    expect(retried.status).toBe(302);
    expect(oidc.discovery).toHaveBeenCalledTimes(2);
  });
});

describe("OIDC RP callback", () => {
  it("persists the tokens server-side and sets a signed 30-day session cookie", async () => {
    useFixedTime();
    const { db, calls } = database();
    const response = await auth(db).handleAuthRequest(callback(await transactionCookie()));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.example/after");
    expect(calls).toContainEqual({
      sql: "DELETE FROM oidc_session WHERE expires_at <= ?",
      args: [NOW],
      operation: "run",
    });
    const insert = calls.find((call) => call.sql.includes("INSERT INTO oidc_session"));
    expect(insert?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())");
    expect(insert?.args.slice(1)).toEqual([
      "local-user",
      "https://issuer.example",
      "subject-1",
      "access-token",
      "refresh-token",
      "signed-id-token",
      NOW + 3_600_000,
      NOW + 2_592_000_000,
    ]);

    const [session, clearedTx] = response.headers.getSetCookie();
    expect(session).toMatch(
      /^app-session=[^;]+; Max-Age=2592000; Path=\/; Secure; HttpOnly; SameSite=Lax$/,
    );
    expect(clearedTx).toMatch(/^app-oidc-tx=; Max-Age=0;/);
    expect(await verifyPayload(cookieValue(session), secret)).toEqual({
      version: 4,
      sessionId: insert?.args[0],
      userId: "local-user",
      issuer: "https://issuer.example",
      subject: "subject-1",
      sid: "idp-session-1",
      expiresAt: NOW + 2_592_000_000,
    });
  });

  it("defaults a missing refresh token and access-token lifetime", async () => {
    useFixedTime();
    oidc.authorizationCodeGrant.mockResolvedValue({
      ...tokenResponse(),
      refresh_token: undefined,
      expires_in: undefined,
    });
    const { db, calls } = database();
    await auth(db).handleAuthRequest(callback(await transactionCookie()));

    const insert = calls.find((call) => call.sql.includes("INSERT INTO oidc_session"));
    expect(insert?.args.slice(5, 8)).toEqual([null, "signed-id-token", NOW + 3_600_000]);
  });

  it("fails closed without touching storage when the ID Token has no usable subject or sid", async () => {
    const claimSets = [
      undefined,
      {},
      { sub: "", sid: "idp-session-1" },
      { sub: 7, sid: "idp-session-1" },
      { sub: "subject-1", sid: "" },
    ];
    for (const claims of claimSets) {
      oidc.authorizationCodeGrant.mockResolvedValue({ ...tokenResponse(), claims: () => claims });
      const { db, calls } = database();
      const response = await auth(db).handleAuthRequest(callback(await transactionCookie()));
      expect(response.status, JSON.stringify(claims)).toBe(400);
      expect(await response.text()).toBe("Authentication failed");
      expect(calls).toHaveLength(0);
    }
  });

  it("fails without a session when the code exchange or UserInfo fails", async () => {
    oidc.authorizationCodeGrant.mockRejectedValueOnce(new Error("invalid_client"));
    const { db, calls } = database();
    const exchange = await auth(db).handleAuthRequest(callback(await transactionCookie()));
    expect(exchange.status).toBe(400);
    expect(await exchange.text()).toBe("Authentication failed");

    oidc.fetchUserInfo.mockRejectedValueOnce(new Error("subject mismatch"));
    const userinfo = await auth(db).handleAuthRequest(callback(await transactionCookie()));
    expect(userinfo.status).toBe(400);
    expect(await userinfo.text()).toBe("Failed to fetch user info");
    expect(calls).toHaveLength(0);
  });

  it("fails closed when discovery metadata has no issuer", async () => {
    for (const [idp, metadata] of [
      ["https://issuerless.example", { issuer: "" }],
      ["https://issuer-missing.example", {}],
    ] as const) {
      oidc.discovery.mockResolvedValue({ serverMetadata: () => metadata });
      const { db, calls } = database();
      const response = await auth(db, idp).handleAuthRequest(callback(await transactionCookie()));
      expect(response.status, idp).toBe(400);
      expect(await response.text()).toBe("Authentication failed");
      expect(calls).toHaveLength(0);
    }
  });

  it("answers 500 without a session cookie when the session cannot be stored", async () => {
    const { db } = database({ failRun: (sql) => sql.includes("INSERT INTO oidc_session") });
    const response = await auth(db).handleAuthRequest(callback(await transactionCookie()));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Authentication failed");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("escapes the sign-in link on the failure page and clears the transaction", async () => {
    const { db } = database();
    const response = await auth(
      db,
      undefined,
      undefined,
      'https://app.example/x?a=1&b="<c>"/',
    ).handleAuthRequest(
      new Request("https://app.example/api/auth/callback/gdgjp?error=access_denied"),
    );
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("set-cookie")).toMatch(/^app-oidc-tx=; Max-Age=0;/);
    expect(await response.text()).toContain(
      'href="https://app.example/x?a=1&amp;b=&quot;&lt;c&gt;&quot;/api/auth/signin"',
    );
  });
});

describe("OIDC RP account linking", () => {
  it("refreshes the display profile of an already linked identity", async () => {
    useFixedTime();
    for (const [claims, name] of [
      [{ name: undefined }, "user@example.com"],
      [{ name: undefined, email: undefined }, ""],
    ] as const) {
      oidc.fetchUserInfo.mockResolvedValue({ ...userInfo(), ...claims });
      const { db, calls } = database();
      await auth(db).handleAuthRequest(callback(await transactionCookie()));

      expect(calls[1]).toEqual({
        sql: 'UPDATE "user" SET name = ?, image = ?, updated_at = ? WHERE id = ?',
        args: [name, "https://example.com/user.png", NOW / 1000, "local-user"],
        operation: "run",
      });
    }
  });

  it("creates a new user for an unseen identity with a verified email", async () => {
    useFixedTime();
    const { db, calls } = database({ linked: null, byEmail: null });
    const response = await auth(db).handleAuthRequest(callback(await transactionCookie()));

    expect(response.status).toBe(302);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO "user"'));
    expect(insert?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    expect(insert?.args.slice(1)).toEqual([
      "user@example.com",
      "Example User",
      "https://example.com/user.png",
      "https://issuer.example",
      "subject-1",
      NOW / 1000,
      NOW / 1000,
    ]);
    const session = calls.find((call) => call.sql.includes("INSERT INTO oidc_session"));
    expect(session?.args[1]).toBe(insert?.args[0]);
  });

  it("links a legacy row by verified email once, guarded against concurrent links", async () => {
    useFixedTime();
    const legacy = { id: "legacy-user", oidc_issuer: null, oidc_subject: null };
    const { db, calls } = database({ linked: null, byEmail: legacy });
    const response = await auth(db).handleAuthRequest(callback(await transactionCookie()));

    expect(response.status).toBe(302);
    const link = calls.find((call) => call.sql.includes("oidc_issuer IS NULL"));
    expect(link?.sql).toContain("SET oidc_issuer = ?, oidc_subject = ?, name = ?, image = ?");
    expect(link?.args).toEqual([
      "https://issuer.example",
      "subject-1",
      "Example User",
      "https://example.com/user.png",
      NOW / 1000,
      "legacy-user",
    ]);

    const raced = database({ linked: null, byEmail: legacy, changes: 0 });
    const lost = await auth(raced.db).handleAuthRequest(callback(await transactionCookie()));
    expect(lost.status).toBe(400);
    expect(raced.calls.some((call) => call.sql.includes("INSERT INTO oidc_session"))).toBe(false);
  });

  it("repairs a stale subject on every loopback issuer form, guarded against races", async () => {
    for (const issuer of ["http://127.0.0.1:5173", "http://[::1]:5173"]) {
      oidc.discovery.mockResolvedValue(configuration(issuer));
      const byEmail = { id: "local-user", oidc_issuer: issuer, oidc_subject: "old-subject" };
      const { db, calls } = database({ linked: null, byEmail });
      const response = await auth(db, issuer).handleAuthRequest(
        callback(await transactionCookie()),
      );
      expect(response.status, issuer).toBe(302);
      expect(calls.find((call) => call.sql.includes("SET oidc_subject = ?"))?.sql).toContain(
        "WHERE id = ? AND oidc_issuer = ? AND oidc_subject = ?",
      );

      const raced = database({ linked: null, byEmail, changes: 0 });
      const lost = await auth(raced.db, issuer).handleAuthRequest(
        callback(await transactionCookie()),
      );
      expect(lost.status, issuer).toBe(400);
    }
  });

  it("does not repair across loopback issuers or onto a row without a subject", async () => {
    oidc.discovery.mockResolvedValue(configuration("http://localhost:5174"));
    for (const byEmail of [
      { id: "local-user", oidc_issuer: "http://127.0.0.1:5174", oidc_subject: "old-subject" },
      { id: "local-user", oidc_issuer: "http://localhost:5174", oidc_subject: null },
    ]) {
      const { db, calls } = database({ linked: null, byEmail });
      const response = await auth(db, "http://localhost:5174").handleAuthRequest(
        callback(await transactionCookie()),
      );
      expect(response.status, JSON.stringify(byEmail)).toBe(400);
      expect(await response.text()).toBe("Authentication failed");
      expect(calls.some((call) => call.operation === "run")).toBe(false);
    }
  });

  it("does not treat an issuer that is not a URL as loopback", async () => {
    oidc.discovery.mockResolvedValue(configuration("issuer-without-scheme"));
    const { db, calls } = database({
      linked: null,
      byEmail: { id: "local-user", oidc_issuer: "issuer-without-scheme", oidc_subject: "old" },
    });
    const response = await auth(db, "https://schemeless-issuer.example").handleAuthRequest(
      callback(await transactionCookie()),
    );
    expect(response.status).toBe(400);
    expect(calls.some((call) => call.operation === "run")).toBe(false);
  });
});

describe("OIDC RP session check", () => {
  it("sends client credentials and JSON to the IdP and fails closed on transport errors", async () => {
    const { db } = database();
    const cookie = `${await sessionCookie()}; gdg_sid=idp-session-1`;
    const idpFetch = sessionCheck();
    await auth(db, undefined, idpFetch).getSessionUser(page(cookie));
    const init = idpFetch.mock.calls[0][1];
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const failures: Array<typeof fetch> = [
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("network");
      }),
      vi.fn<typeof fetch>(async () => new Response("bad gateway", { status: 502 })),
      vi.fn<typeof fetch>(async () =>
        Response.json({ active: true, ...userInfo() }, { status: 500 }),
      ),
      vi.fn<typeof fetch>(async () => new Response("not json")),
    ];
    for (const failing of failures) {
      const rejected = await auth(db, undefined, failing)
        .getSessionUser(page(cookie))
        .catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(Response);
      const response = rejected as Response;
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await response.text()).toBe("Sign-in service temporarily unavailable");
    }
  });

  it("ends the session unless the IdP strictly confirms an active session for this subject", async () => {
    for (const body of [
      { active: false },
      { ...userInfo(), active: "true" },
      { ...userInfo(), active: true, sub: "subject-2" },
    ]) {
      const { db, calls } = database();
      const user = await auth(db, undefined, sessionCheck(body)).getSessionUser(
        page(`${await sessionCookie()}; gdg_sid=idp-session-1`),
      );
      expect(user, JSON.stringify(body)).toBeNull();
      expect(calls).toContainEqual(
        expect.objectContaining({
          sql: "DELETE FROM oidc_session WHERE id = ?",
          args: ["session-1"],
        }),
      );
    }
  });

  it("falls back to empty display fields and keeps only well-formed chapters", async () => {
    const { db, calls } = database();
    const instance = auth(
      db,
      undefined,
      sessionCheck({
        active: true,
        sub: "subject-1",
        [CHAPTERS_CLAIM]: [
          null,
          "tokyo",
          { chapterId: "10", chapterSlug: "tokyo", role: "organizer" },
          { chapterId: 10, chapterSlug: 10, role: "organizer" },
          { chapterId: 10, chapterSlug: "tokyo", role: "owner" },
          { chapterId: 20, chapterSlug: "osaka", role: "member" },
        ],
      }),
    );
    const request = page(`${await sessionCookie({ userId: "bare-user" })}; gdg_sid=idp-session-1`);

    expect(await instance.getSessionUser(request)).toEqual({
      id: "bare-user",
      email: "",
      name: "",
      image: null,
      isAdmin: false,
    });
    expect(await instance.getFreshClaims(request)).toEqual({
      sub: "subject-1",
      email: null,
      name: null,
      picture: null,
      emailVerified: false,
      isAdmin: false,
      chapter: { chapterId: 20, chapterSlug: "osaka", role: "member" },
      chapters: [{ chapterId: 20, chapterSlug: "osaka", role: "member" }],
    });
    expect(calls.find((call) => call.sql.includes('UPDATE "user"'))?.args.slice(0, 2)).toEqual([
      "",
      null,
    ]);

    const scalar = auth(
      db,
      undefined,
      sessionCheck({ active: true, sub: "subject-1", [CHAPTERS_CLAIM]: "tokyo" }),
    );
    expect((await scalar.getFreshClaims(request)).chapters).toEqual([]);
  });

  it("writes the display profile only when it changed, and retries a failed write", async () => {
    useFixedTime();
    const cookie = `${await sessionCookie({ userId: "memo-user" })}; gdg_sid=idp-session-1`;
    const updates = (calls: Array<{ sql: string; args: unknown[] }>) =>
      calls.filter((call) => call.sql.includes('UPDATE "user"'));

    const failing = database({ failRun: (sql) => sql.includes('UPDATE "user"') });
    expect((await auth(failing.db).getSessionUser(page(cookie)))?.id).toBe("memo-user");

    const { db, calls } = database();
    const instance = auth(db);
    await instance.getSessionUser(page(cookie));
    await instance.getSessionUser(page(cookie));
    expect(updates(calls)).toHaveLength(1);
    expect(updates(calls)[0].args).toEqual([
      "Example User",
      "https://example.com/user.png",
      NOW / 1000,
      "memo-user",
      "Example User",
      "https://example.com/user.png",
    ]);

    const other = `${await sessionCookie({ userId: "memo-other" })}; gdg_sid=idp-session-1`;
    await instance.getSessionUser(page(other));
    await instance.getSessionUser(page(cookie));
    expect(updates(calls)).toHaveLength(2);
  });
});

describe("OIDC RP sign-out", () => {
  it("clears the local session even when the IdP issuer changed or is unreachable", async () => {
    const stale = database({
      tokenSession: storedSession({ issuer: "https://old-issuer.example" }),
    });
    const changed = await auth(stale.db).handleSignOutRedirect(page(await sessionCookie()));
    expect(changed.headers.get("location")).toBe("https://app.example/signin");
    expect(changed.headers.get("set-cookie")).toMatch(/^app-session=; Max-Age=0;/);
    expect(stale.calls).toContainEqual(
      expect.objectContaining({
        sql: "DELETE FROM oidc_session WHERE id = ?",
        args: ["session-1"],
      }),
    );

    oidc.discovery.mockRejectedValueOnce(new Error("unreachable"));
    const down = database({
      tokenSession: storedSession({ issuer: "https://signout-down.example" }),
    });
    const unreachable = await auth(down.db, "https://signout-down.example").handleSignOutRedirect(
      page(await sessionCookie({ issuer: "https://signout-down.example" })),
    );
    expect(unreachable.headers.get("location")).toBe("https://app.example/signin");
  });

  it("returns only to same-origin targets after RP-Initiated Logout", async () => {
    const { db } = database();
    const instance = auth(db);
    const kept = await instance.handleSignOutRedirect(new Request("https://app.example/"), {
      returnTo: "/bye",
    });
    expect(kept.headers.get("location")).toBe("https://app.example/bye");
    const dropped = await instance.handleSignOutRedirect(new Request("https://app.example/"), {
      returnTo: "https://evil.example/",
    });
    expect(dropped.headers.get("location")).toBe("https://app.example/");
  });

  it("ignores a malformed session cookie when signing out", async () => {
    for (const sid of ["", ["idp-session-1"]]) {
      const { db, calls } = database({ tokenSession: storedSession() });
      const response = await auth(db).handleSignOutRedirect(page(await sessionCookie({ sid })));
      expect(response.headers.get("location"), JSON.stringify(sid)).toBe(
        "https://app.example/signin",
      );
      expect(calls).toHaveLength(0);
    }
  });

  it("resolves default return targets against the app origin, not its path", async () => {
    const { db } = database();
    const instance = auth(db, undefined, undefined, "https://app.example/base");
    for (const returnTo of [undefined, "https://evil.example/"]) {
      const response = await instance.handleSignOutRedirect(new Request("https://app.example/"), {
        returnTo,
      });
      expect(response.headers.get("location"), String(returnTo)).toBe(
        returnTo ? "https://app.example/" : "https://app.example/signin",
      );
    }
    const signIn = await instance.handleAuthRequest(
      new Request("https://app.example/api/auth/signin"),
    );
    const tx = await verifyPayload<{ returnTo: string }>(
      cookieValue(signIn.headers.get("set-cookie") ?? ""),
      secret,
    );
    expect(tx?.returnTo).toBe("https://app.example/");
  });

  it("does not look up server-side tokens for a dev session", async () => {
    const local = "http://localhost:5199";
    const { db, calls } = database({ tokenSession: storedSession() });
    const instance = auth(db, "http://localhost:5173", sessionCheck(), local);
    const login = await instance.handleDevLogin(new Request(`${local}/dev/login`));
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    calls.length = 0;

    await instance.handleSignOutRedirect(page(cookie, `${local}/auth/signout`));
    expect(calls).toHaveLength(0);
  });
});

describe("OIDC RP access tokens", () => {
  const cookie = () => sessionCookie().then((value) => `${value}; gdg_sid=idp-session-1`);

  it("returns a fresh stored access token without refreshing it", async () => {
    useFixedTime();
    const { db } = database({
      tokenSession: storedSession({ accessTokenExpiresAt: NOW + 30_000 }),
    });
    expect(await auth(db).getAccessToken(page(await cookie()))).toBe("access-token");
    expect(oidc.refreshTokenGrant).not.toHaveBeenCalled();
  });

  it("refuses tokens that do not belong to the signed-in session", async () => {
    useFixedTime();
    const rows = [
      null,
      storedSession({ userId: "other-user" }),
      storedSession({ issuer: "https://other-issuer.example" }),
      storedSession({ subject: "subject-2" }),
      storedSession({ expiresAt: NOW }),
    ];
    for (const row of rows) {
      const { db } = database({ tokenSession: row });
      await expect(
        auth(db).getAccessToken(page(await cookie())),
        JSON.stringify(row),
      ).rejects.toMatchObject({ reason: "no_linked_account" });
    }
  });

  it("refuses tokens when discovery fails or names another issuer", async () => {
    const issuer = "https://token-issuer.example";
    const session = `${await sessionCookie({ issuer })}; gdg_sid=idp-session-1`;
    const { db } = database({ tokenSession: storedSession({ issuer }) });

    oidc.discovery.mockRejectedValueOnce(new Error("unreachable"));
    await expect(auth(db, issuer).getAccessToken(page(session))).rejects.toMatchObject({
      reason: "userinfo_failed",
    });

    oidc.discovery.mockResolvedValueOnce(configuration("https://moved-issuer.example"));
    await expect(auth(db, issuer).getAccessToken(page(session))).rejects.toMatchObject({
      reason: "userinfo_failed",
    });
  });

  it("does not hand out access tokens for dev sessions", async () => {
    const local = "http://localhost:5199";
    const { db } = database();
    const instance = auth(db, "http://localhost:5173", sessionCheck(), local);
    const login = await instance.handleDevLogin(new Request(`${local}/dev/login`));
    const devCookie = login.headers.getSetCookie()[0].split(";")[0];
    await expect(instance.getAccessToken(page(devCookie, `${local}/`))).rejects.toMatchObject({
      reason: "no_linked_account",
    });
  });

  it("keeps the current refresh and ID tokens when the IdP does not rotate them", async () => {
    useFixedTime();
    oidc.refreshTokenGrant.mockResolvedValue({ access_token: "rotated-access-token" });
    const { db, calls } = database({
      tokenSession: storedSession({ accessTokenExpiresAt: NOW + 29_999 }),
    });
    expect(await auth(db).getAccessToken(page(await cookie()))).toBe("rotated-access-token");
    const update = calls.find((call) => call.sql.includes("UPDATE oidc_session"));
    expect(update?.sql).toContain("WHERE id = ? AND refresh_token = ?");
    expect(update?.args).toEqual([
      "rotated-access-token",
      "refresh-token",
      "signed-id-token",
      NOW + 3_600_000,
      "session-1",
      "refresh-token",
    ]);
  });

  it("fails without a refresh token", async () => {
    useFixedTime();
    const { db } = database({
      tokenSession: storedSession({ refreshToken: null, accessTokenExpiresAt: NOW }),
    });
    await expect(auth(db).getAccessToken(page(await cookie()))).rejects.toMatchObject({
      reason: "refresh_failed",
    });
    expect(oidc.refreshTokenGrant).not.toHaveBeenCalled();
  });

  it("adopts a concurrent rotation only when it is fresh", async () => {
    useFixedTime();
    oidc.refreshTokenGrant.mockRejectedValue(new Error("invalid_grant"));
    const expired = storedSession({ accessTokenExpiresAt: NOW });
    const winner = storedSession({
      accessToken: "winner-access-token",
      refreshToken: "winner-refresh-token",
      accessTokenExpiresAt: NOW + 30_000,
    });
    const adopted = database({ tokenReads: [expired, winner] });
    expect(await auth(adopted.db).getAccessToken(page(await cookie()))).toBe("winner-access-token");

    for (const loser of [
      null,
      storedSession({ accessTokenExpiresAt: NOW + 60_000 }),
      { ...winner, accessTokenExpiresAt: NOW + 29_999 },
    ]) {
      const { db } = database({ tokenReads: [expired, loser] });
      await expect(
        auth(db).getAccessToken(page(await cookie())),
        JSON.stringify(loser),
      ).rejects.toMatchObject({ reason: "refresh_failed" });
    }
  });

  it("returns the stored winner when the compare-and-swap update loses", async () => {
    useFixedTime();
    oidc.refreshTokenGrant.mockResolvedValue({
      access_token: "rotated-access-token",
      refresh_token: "rotated-refresh-token",
      expires_in: 60,
    });
    const expired = storedSession({ accessTokenExpiresAt: NOW });
    const winner = storedSession({ accessToken: "winner-access-token" });
    const lost = database({ tokenReads: [expired, winner], changes: 0 });
    expect(await auth(lost.db).getAccessToken(page(await cookie()))).toBe("winner-access-token");

    const gone = database({ tokenReads: [expired, null], changes: 0 });
    await expect(auth(gone.db).getAccessToken(page(await cookie()))).rejects.toMatchObject({
      reason: "refresh_failed",
    });

    const won = database({ tokenReads: [expired] });
    expect(await auth(won.db).getAccessToken(page(await cookie()))).toBe("rotated-access-token");
    expect(won.calls.find((call) => call.sql.includes("UPDATE oidc_session"))?.args[3]).toBe(
      NOW + 60_000,
    );
  });
});

describe("dev login details", () => {
  const local = "http://localhost:5199";

  it("is available on 127.0.0.1 and unavailable when the app URL is not a URL", async () => {
    const { db } = database();
    const loopback = await auth(
      db,
      "http://localhost:5173",
      sessionCheck(),
      "http://127.0.0.1:5199",
    ).handleDevLogin(new Request("http://127.0.0.1:5199/dev/login"));
    expect(loopback.status).toBe(302);

    const invalid = await auth(db, undefined, undefined, "not a url").handleDevLogin(
      new Request("http://localhost:5199/dev/login"),
    );
    expect(invalid.status).toBe(404);
  });

  it("sanitizes the dev identity and defaults to a non-admin organizer of one chapter", async () => {
    useFixedTime();
    const { db, calls } = database();
    const instance = auth(db, "http://localhost:5173", sessionCheck(), local);
    const login = await instance.handleDevLogin(
      new Request(`${local}/dev/login?as=${encodeURIComponent("Ow ner<!>")}${"x".repeat(40)}`),
    );
    const as = `Owner${"x".repeat(35)}`;

    expect(login.headers.get("location")).toBe(`${local}/`);
    const setCookie = login.headers.getSetCookie()[0];
    expect(setCookie).toMatch(
      /^app-session=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    const insert = calls.find((call) => call.sql.includes('INSERT INTO "user"'));
    expect(insert?.sql).toContain("ON CONFLICT(id) DO UPDATE SET name = excluded.name");
    expect(insert?.args).toEqual([
      `dev-user-${as}`,
      `${as}@dev.local`,
      `${as} (dev)`,
      "http://localhost:5173",
      `dev-${as}`,
      NOW / 1000,
      NOW / 1000,
    ]);
    const session = await verifyPayload<Record<string, unknown>>(cookieValue(setCookie), secret);
    expect(session?.expiresAt).toBe(NOW + 2_592_000_000);

    const cookie = setCookie.split(";")[0];
    expect(await instance.getFreshClaims(page(cookie, `${local}/`))).toEqual({
      sub: `dev-${as}`,
      email: `${as}@dev.local`,
      name: `${as} (dev)`,
      picture: null,
      emailVerified: true,
      isAdmin: false,
      chapter: { chapterId: 1, chapterSlug: "dev-chapter", role: "organizer" },
      chapters: [{ chapterId: 1, chapterSlug: "dev-chapter", role: "organizer" }],
    });
  });

  it("falls back to the dev identity and drops invalid chapter ids", async () => {
    const { db } = database();
    const instance = auth(db, "http://localhost:5173", sessionCheck(), local);
    for (const query of ["?", "?as=%21%21&"]) {
      const login = await instance.handleDevLogin(
        new Request(`${local}/dev/login${query}chapter=0:zero&chapter=9`),
      );
      const cookie = login.headers.getSetCookie()[0].split(";")[0];
      expect(await instance.getFreshClaims(page(cookie, `${local}/`))).toMatchObject({
        sub: "dev-dev",
        chapters: [{ chapterId: 9, chapterSlug: "chapter-9", role: "organizer" }],
      });
    }
  });
});
