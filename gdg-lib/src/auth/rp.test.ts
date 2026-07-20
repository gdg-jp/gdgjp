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

function auth(db: D1Database, issuer = "https://issuer.example") {
  return initializeRpAuth({
    db,
    appUrl: "https://app.example",
    cookiePrefix: "app",
    secret,
    idp: { url: issuer, clientId: "client", clientSecret: "client-secret" },
  });
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
  return `app-oidc-tx=${value}`;
}

function tokenResponse(idToken = "signed-id-token") {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    id_token: idToken,
    claims: () => ({ sub: "subject-1" }),
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

describe("OIDC RP", () => {
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

  it("requires an ID Token, validates nonce, and binds UserInfo to its subject", async () => {
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

    const sessionCookie = response.headers.getSetCookie()[0].split(";")[0];
    const claims = await instance.getFreshClaims(
      new Request("https://app.example/dashboard", { headers: { Cookie: sessionCookie } }),
    );
    expect(claims.isAdmin).toBe(true);
    expect(claims.chapter).toEqual({ chapterId: 10, chapterSlug: "tokyo", role: "organizer" });
    expect(claims.chapters).toHaveLength(2);
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

  it("uses RP-Initiated Logout with an ID Token hint", async () => {
    const sessionId = "session-1";
    const session = await signPayload(
      {
        version: 3,
        sessionId,
        userId: "local-user",
        issuer: "https://issuer.example",
        subject: "subject-1",
        email: "user@example.com",
        name: "Example User",
        picture: null,
        isAdmin: false,
        expiresAt: Date.now() + 60_000,
      },
      secret,
    );
    const { db, calls } = database({
      tokenSession: {
        id: sessionId,
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
      new Request("https://app.example/auth/signout", {
        headers: { Cookie: `app-session=${session}` },
      }),
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
    const sessionId = "session-2";
    const session = await signPayload(
      {
        version: 3,
        sessionId,
        userId: "local-user",
        issuer: "https://issuer.example",
        subject: "subject-1",
        email: "user@example.com",
        name: "Example User",
        picture: null,
        isAdmin: false,
        expiresAt: Date.now() + 60_000,
      },
      secret,
    );
    const { db, calls } = database({
      tokenSession: {
        id: sessionId,
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

    await auth(db).getFreshClaims(
      new Request("https://app.example/", { headers: { Cookie: `app-session=${session}` } }),
    );

    expect(oidc.refreshTokenGrant).toHaveBeenCalledWith(expect.anything(), "refresh-token");
    expect(oidc.fetchUserInfo).toHaveBeenCalledWith(
      expect.anything(),
      "rotated-access-token",
      "subject-1",
    );
    const update = calls.find((call) => call.sql.includes("UPDATE oidc_session"));
    expect(update?.args.slice(0, 3)).toEqual([
      "rotated-access-token",
      "rotated-refresh-token",
      "rotated-id-token",
    ]);
  });

  it("rejects pre-v3 sessions", async () => {
    const legacy = await signPayload(
      {
        userId: "local-user",
        email: "user@example.com",
        name: "Example User",
        picture: null,
        isAdmin: true,
      },
      secret,
    );
    const { db } = database();
    const user = await auth(db).getSessionUser(
      new Request("https://app.example/", { headers: { Cookie: `app-session=${legacy}` } }),
    );

    expect(user).toBeNull();
  });
});
