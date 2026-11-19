import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_CONNECTION_AAD,
  bytesToBase64Url,
  decryptRefreshToken,
} from "~/features/google/encryption.server";
import {
  GOOGLE_OAUTH_SCOPES,
  GOOGLE_REQUIRED_SCOPES,
  type GoogleConnectionRow,
  type GoogleOAuthEnv,
  buildGoogleAuthorizeUrl,
  completeGoogleOauthCallback,
  consumeGoogleOauthState,
  createGoogleOauthState,
  getGoogleConnection,
  getGoogleConnectionSummary,
  googleRedirectUri,
} from "~/features/google/oauth.server";

type StateRow = {
  id: string;
  user_id: string;
  code_verifier: string;
  created_at: string;
  expires_at: string;
};

function createFakeDb() {
  const states: StateRow[] = [];
  let connection: GoogleConnectionRow | null = null;

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async run() {
          if (sql.startsWith("DELETE FROM google_oauth_state WHERE expires_at")) {
            const [now] = args as [string];
            for (let i = states.length - 1; i >= 0; i--) {
              if (states[i].expires_at <= now) states.splice(i, 1);
            }
            return { success: true, meta: {} };
          }
          if (sql.startsWith("INSERT INTO google_oauth_state")) {
            const [id, user_id, code_verifier, created_at, expires_at] = args as string[];
            states.push({ id, user_id, code_verifier, created_at, expires_at });
            return { success: true, meta: {} };
          }
          if (sql.startsWith("INSERT INTO google_connection")) {
            const [
              id,
              email,
              google_user_id,
              refresh_token_ciphertext,
              refresh_token_nonce,
              encryption_key_version,
              scope,
              connected_by_user_id,
              connected_at,
              updated_at,
            ] = args as [
              number,
              string,
              string,
              string,
              string,
              number,
              string,
              string,
              string,
              string,
            ];
            connection = {
              id,
              email,
              google_user_id,
              refresh_token_ciphertext,
              refresh_token_nonce,
              encryption_key_version,
              scope,
              connected_by_user_id,
              connected_at,
              updated_at,
              status: "connected",
              last_error: null,
            };
            return { success: true, meta: {} };
          }
          throw new Error(`未対応の run(): ${sql}`);
        },
        async first<T>(): Promise<T | null> {
          if (sql.startsWith("DELETE FROM google_oauth_state WHERE id")) {
            const [id] = args as [string];
            const index = states.findIndex((s) => s.id === id);
            if (index === -1) return null;
            const [row] = states.splice(index, 1);
            return {
              user_id: row.user_id,
              code_verifier: row.code_verifier,
              expires_at: row.expires_at,
            } as T;
          }
          if (sql.includes("FROM google_connection WHERE id = ?")) {
            return connection as T | null;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
      };
      return stmt;
    },
  };

  return {
    db: db as unknown as D1Database,
    getConnection: () => connection,
  };
}

function makeFakeIdToken(payload: Record<string, unknown>): string {
  const enc = (value: Record<string, unknown>) =>
    bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(payload)}.fake-signature`;
}

function createEnv(db: D1Database): GoogleOAuthEnv {
  return {
    DB: db,
    APP_URL: "https://meet.gdgs.jp",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GOOGLE_HOST_EMAIL: "community-support@gdgoc.jp",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(5)).toString("base64"),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildGoogleAuthorizeUrl", () => {
  it("offline / consent / hd / login_hint / PKCE S256 を含む認可 URL を組み立てる", () => {
    const { db } = createFakeDb();
    const env = createEnv(db);
    const url = new URL(buildGoogleAuthorizeUrl(env, "state-1", "challenge-1"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(googleRedirectUri(env));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_OAUTH_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("hd")).toBe("gdgoc.jp");
    expect(url.searchParams.get("login_hint")).toBe("community-support@gdgoc.jp");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("google_oauth_state 単回消費", () => {
  it("有効な state は 1 回だけ消費でき、リプレイは拒否される", async () => {
    const { db } = createFakeDb();
    const { state } = await createGoogleOauthState(db, "admin-1");

    const first = await consumeGoogleOauthState(db, state, "admin-1");
    expect(first.ok).toBe(true);

    const replay = await consumeGoogleOauthState(db, state, "admin-1");
    expect(replay).toEqual({ ok: false, reason: "not_found" });
  });

  it("別セッションからの提示および期限切れ state を拒否する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T00:00:00.000Z"));
    const { db } = createFakeDb();

    const { state: s1 } = await createGoogleOauthState(db, "admin-1");
    expect(await consumeGoogleOauthState(db, s1, "other-admin")).toEqual({
      ok: false,
      reason: "session_mismatch",
    });

    const { state: s2 } = await createGoogleOauthState(db, "admin-1");
    vi.advanceTimersByTime(601 * 1000);
    expect(await consumeGoogleOauthState(db, s2, "admin-1")).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("completeGoogleOauthCallback", () => {
  it("ホストアカウントの正常同意で暗号化リフレッシュトークンと sub を保存する", async () => {
    const { db } = createFakeDb();
    const env = createEnv(db);
    const { state } = await createGoogleOauthState(db, "admin-1");

    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "ya29.test-access",
        refresh_token: "1//0g-test-refresh",
        id_token: makeFakeIdToken({
          aud: env.GOOGLE_CLIENT_ID,
          sub: "110123456789012345678",
          email: "community-support@gdgoc.jp",
          email_verified: true,
        }),
        scope: GOOGLE_OAUTH_SCOPES.join(" "),
        expires_in: 3600,
      }),
    ) as unknown as typeof fetch;

    const result = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "auth-code", googleError: null },
      fetchMock,
    );

    expect(result).toEqual({
      ok: true,
      email: "community-support@gdgoc.jp",
      googleUserId: "110123456789012345678",
    });

    const saved = await getGoogleConnection(db);
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe("connected");
    expect(saved?.google_user_id).toBe("110123456789012345678");
    const plaintext = await decryptRefreshToken(
      env,
      GOOGLE_CONNECTION_AAD,
      saved?.encryption_key_version ?? 0,
      saved?.refresh_token_ciphertext ?? "",
      saved?.refresh_token_nonce ?? "",
    );
    expect(plaintext).toBe("1//0g-test-refresh");

    const summary = await getGoogleConnectionSummary(db);
    expect(summary).toMatchObject({
      status: "connected",
      email: "community-support@gdgoc.jp",
      googleUserId: "110123456789012345678",
    });
  });

  it("GOOGLE_HOST_EMAIL 以外のアカウントでの同意を拒否し D1 へ保存しない", async () => {
    const { db, getConnection } = createFakeDb();
    const env = createEnv(db);
    const { state } = await createGoogleOauthState(db, "admin-1");

    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "ya29.test",
        refresh_token: "1//0g-other",
        id_token: makeFakeIdToken({
          aud: env.GOOGLE_CLIENT_ID,
          sub: "99999",
          email: "someone-else@gdgoc.jp",
          email_verified: true,
        }),
        scope: GOOGLE_OAUTH_SCOPES.join(" "),
        expires_in: 3600,
      }),
    ) as unknown as typeof fetch;

    const result = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "code", googleError: null },
      fetchMock,
    );
    expect(result).toEqual({ ok: false, errorCode: "wrong_account" });
    expect(getConnection()).toBeNull();
  });

  it("email_verified が false の場合は拒否する", async () => {
    const { db, getConnection } = createFakeDb();
    const env = createEnv(db);
    const { state } = await createGoogleOauthState(db, "admin-1");

    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "ya29.test",
        refresh_token: "1//0g-token",
        id_token: makeFakeIdToken({
          aud: env.GOOGLE_CLIENT_ID,
          sub: "12345",
          email: "community-support@gdgoc.jp",
          email_verified: false,
        }),
        scope: GOOGLE_OAUTH_SCOPES.join(" "),
        expires_in: 3600,
      }),
    ) as unknown as typeof fetch;

    const result = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "code", googleError: null },
      fetchMock,
    );
    expect(result).toEqual({ ok: false, errorCode: "email_unverified" });
    expect(getConnection()).toBeNull();
  });

  it("必須スコープが 1 つでも欠落している場合は拒否する", async () => {
    const { db, getConnection } = createFakeDb();
    const env = createEnv(db);
    const { state } = await createGoogleOauthState(db, "admin-1");

    const partialScopes = GOOGLE_REQUIRED_SCOPES.slice(0, 2).join(" ");
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "ya29.test",
        refresh_token: "1//0g-token",
        id_token: makeFakeIdToken({
          aud: env.GOOGLE_CLIENT_ID,
          sub: "12345",
          email: "community-support@gdgoc.jp",
          email_verified: true,
        }),
        scope: `${partialScopes} openid email`,
        expires_in: 3600,
      }),
    ) as unknown as typeof fetch;

    const result = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "code", googleError: null },
      fetchMock,
    );
    expect(result).toEqual({ ok: false, errorCode: "scope_missing" });
    expect(getConnection()).toBeNull();
  });

  it("refresh_token が欠落している場合は拒否する", async () => {
    const { db, getConnection } = createFakeDb();
    const env = createEnv(db);
    const { state } = await createGoogleOauthState(db, "admin-1");

    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "ya29.test",
        id_token: makeFakeIdToken({
          aud: env.GOOGLE_CLIENT_ID,
          sub: "12345",
          email: "community-support@gdgoc.jp",
          email_verified: true,
        }),
        scope: GOOGLE_OAUTH_SCOPES.join(" "),
        expires_in: 3600,
      }),
    ) as unknown as typeof fetch;

    const result = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "code", googleError: null },
      fetchMock,
    );
    expect(result).toEqual({ ok: false, errorCode: "missing_refresh_token" });
    expect(getConnection()).toBeNull();
  });

  it("リプレイされた state を拒否する", async () => {
    const { db } = createFakeDb();
    const env = createEnv(db);
    const { state } = await createGoogleOauthState(db, "admin-1");

    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "ya29.test",
        refresh_token: "1//0g-token",
        id_token: makeFakeIdToken({
          aud: env.GOOGLE_CLIENT_ID,
          sub: "12345",
          email: "community-support@gdgoc.jp",
          email_verified: true,
        }),
        scope: GOOGLE_OAUTH_SCOPES.join(" "),
        expires_in: 3600,
      }),
    ) as unknown as typeof fetch;

    const first = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "code", googleError: null },
      fetchMock,
    );
    expect(first.ok).toBe(true);

    const replay = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "code", googleError: null },
      fetchMock,
    );
    expect(replay).toEqual({ ok: false, errorCode: "state_invalid" });
  });

  it("id_token がない場合は userinfo エンドポイントで本人確認を行う", async () => {
    const { db } = createFakeDb();
    const env = createEnv(db);
    const { state } = await createGoogleOauthState(db, "admin-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({
          access_token: "ya29.test-userinfo",
          refresh_token: "1//0g-refresh",
          scope: GOOGLE_OAUTH_SCOPES.join(" "),
          expires_in: 3600,
        });
      }
      return Response.json({
        sub: "220987654321",
        email: "community-support@gdgoc.jp",
        email_verified: true,
      });
    }) as unknown as typeof fetch;

    const result = await completeGoogleOauthCallback(
      env,
      "admin-1",
      { state, code: "code", googleError: null },
      fetchMock,
    );
    expect(result).toEqual({
      ok: true,
      email: "community-support@gdgoc.jp",
      googleUserId: "220987654321",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
