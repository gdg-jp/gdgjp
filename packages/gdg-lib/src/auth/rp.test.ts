import type { D1Database } from "@cloudflare/workers-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signPayload } from "./cookie";
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
  allowInsecureRequests: Symbol("allowInsecureRequests"),
  customFetch: Symbol("customFetch"),
}));

vi.mock("openid-client", () => oidc);

import { initializeRpAuth } from "./rp";

const secret = "test-secret";

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
}) {
  const calls: Array<{ sql: string; args: unknown[]; operation: "first" | "run" }> = [];
  let tokenSession = options?.tokenSession ?? null;
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
          if (sql.includes("FROM oidc_session")) return tokenSession;
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
          return { meta: { changes: 1 } };
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

describe("OIDC RP sign-in", () => {
  it("requests the standard scopes plus the namespaced chapter scope with PKCE and nonce", async () => {
    const { db } = database();
    const response = await auth(db).handleAuthRequest(
      new Request("https://app.example/api/auth/signin"),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("scope")).toBe(
      `openid email profile offline_access ${CHAPTERS_SCOPE}`,
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("nonce")).toBe("nonce");
  });

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
      "client-secret",
      undefined,
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
    // The local row no longer snapshots is_admin.
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

  it("is signed out and drops stored tokens once the IdP session has ended", async () => {
    const { db, calls } = database();
    const user = await auth(db, undefined, sessionCheck({ active: false })).getSessionUser(
      page(`${await sessionCookie()}; gdg_sid=idp-session-1`),
    );

    expect(user).toBeNull();
    expect(calls).toContainEqual(
      expect.objectContaining({
        sql: "DELETE FROM oidc_session WHERE id = ?",
        args: ["session-1"],
      }),
    );
  });

  it("fails closed with 503 when the IdP cannot be asked", async () => {
    const { db } = database();
    const down = vi.fn<typeof fetch>(async () => new Response("bad gateway", { status: 502 }));
    const rejected = await auth(db, undefined, down)
      .getSessionUser(page(`${await sessionCookie()}; gdg_sid=idp-session-1`))
      .catch((error: unknown) => error);

    expect(rejected).toBeInstanceOf(Response);
    expect((rejected as Response).status).toBe(503);
  });

  it("rejects sessions from before the IdP binding (v3)", async () => {
    const legacy = await signPayload(
      {
        version: 3,
        sessionId: "session-1",
        userId: "local-user",
        issuer: "https://issuer.example",
        subject: "subject-1",
        email: "user@example.com",
        name: "Example User",
        picture: null,
        isAdmin: true,
        expiresAt: Date.now() + 60_000,
      },
      secret,
    );
    const idpFetch = sessionCheck();
    const { db } = database();
    const user = await auth(db, undefined, idpFetch).getSessionUser(
      page(`app-session=${legacy}; gdg_sid=idp-session-1`),
    );

    expect(user).toBeNull();
    expect(idpFetch).not.toHaveBeenCalled();
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
