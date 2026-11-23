import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import {
  GoogleConnectionError,
  type GoogleTokenEnv,
  getGoogleAccessToken,
  resetGoogleAccessTokenCache,
} from "~/features/google/token.server";

function createFakeDb(initial: GoogleConnectionRow | null) {
  let row = initial;

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes("FROM google_connection WHERE id = ?")) {
            return row as T | null;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async run() {
          if (sql.includes("SET status = 'disconnected'")) {
            const [lastError, updatedAt] = args as [string, string];
            if (row) {
              row = {
                ...row,
                status: "disconnected",
                last_error: lastError,
                updated_at: updatedAt,
              };
            }
            return { success: true, meta: {} };
          }
          if (sql.includes("SET refresh_token_ciphertext = ?")) {
            const [ciphertext, nonce, keyVersion, updatedAt] = args as [
              string,
              string,
              number,
              string,
            ];
            if (row) {
              row = {
                ...row,
                refresh_token_ciphertext: ciphertext,
                refresh_token_nonce: nonce,
                encryption_key_version: keyVersion,
                updated_at: updatedAt,
              };
            }
            return { success: true, meta: {} };
          }
          throw new Error(`未対応の run(): ${sql}`);
        },
      };
      return stmt;
    },
  };

  return {
    db: db as unknown as D1Database,
    getRow: () => row,
  };
}

const KEY = Buffer.from(new Uint8Array(32).fill(11)).toString("base64");

async function createConnectedFixture(status: "connected" | "disconnected" = "connected") {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-refresh-token",
  );
  const fixture = createFakeDb({
    id: 1,
    email: "community-support@gdgoc.jp",
    google_user_id: "110123456789",
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_nonce: encrypted.nonce,
    encryption_key_version: encrypted.keyVersion,
    scope: "https://www.googleapis.com/auth/meetings.space.created",
    connected_by_user_id: "admin-1",
    connected_at: "2026-11-19T00:00:00.000Z",
    updated_at: "2026-11-19T00:00:00.000Z",
    status,
    last_error: null,
  });
  const env: GoogleTokenEnv = {
    DB: fixture.db,
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY,
  };
  return { ...fixture, env };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  vi.useRealTimers();
  resetGoogleAccessTokenCache();
});

describe("getGoogleAccessToken", () => {
  it("有効期限の 60 秒より前まではキャッシュを再利用し、期限間近で再取得する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T00:00:00.000Z"));
    const { env } = await createConnectedFixture();

    let count = 0;
    const fetchMock = vi.fn(async () => {
      count += 1;
      return Response.json({ access_token: `access-${count}`, expires_in: 3600 });
    }) as unknown as typeof fetch;

    expect(await getGoogleAccessToken(env, fetchMock)).toBe("access-1");

    vi.advanceTimersByTime(58 * 60 * 1000);
    expect(await getGoogleAccessToken(env, fetchMock)).toBe("access-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61 * 1000);
    expect(await getGoogleAccessToken(env, fetchMock)).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("並行呼び出しは single-flight で 1 本のリフレッシュに合流する", async () => {
    const { env } = await createConnectedFixture();

    const fetchMock = vi.fn(async () =>
      Response.json({ access_token: "shared-access", expires_in: 3600 }),
    ) as unknown as typeof fetch;

    const [a, b, c] = await Promise.all([
      getGoogleAccessToken(env, fetchMock),
      getGoogleAccessToken(env, fetchMock),
      getGoogleAccessToken(env, fetchMock),
    ]);

    expect([a, b, c]).toEqual(["shared-access", "shared-access", "shared-access"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("未接続または disconnected の場合は not_connected エラーを投げる", async () => {
    const emptyDb = createFakeDb(null);
    const emptyEnv: GoogleTokenEnv = {
      DB: emptyDb.db,
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_TOKEN_ENCRYPTION_KEY: KEY,
    };
    await expect(
      getGoogleAccessToken(emptyEnv, vi.fn() as unknown as typeof fetch),
    ).rejects.toThrow(GoogleConnectionError);

    const disconnected = await createConnectedFixture("disconnected");
    await expect(
      getGoogleAccessToken(disconnected.env, vi.fn() as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "not_connected" });
  });

  it("invalid_grant を受けたら D1 を disconnected へ遷移し last_error を残す", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T01:00:00.000Z"));
    const { env, getRow } = await createConnectedFixture();

    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        { status: 400 },
      ),
    ) as unknown as typeof fetch;

    await expect(getGoogleAccessToken(env, fetchMock)).rejects.toMatchObject({
      code: "invalid_grant",
    });

    const updated = getRow();
    expect(updated?.status).toBe("disconnected");
    expect(updated?.last_error).toContain("invalid_grant");
    expect(updated?.last_error).not.toContain("1//0g-refresh-token");
    expect(updated?.updated_at).toBe("2026-11-19T01:00:00.000Z");
  });

  it("一時的な 503 エラーでは disconnected に倒さず refresh_failed を投げる", async () => {
    const { env, getRow } = await createConnectedFixture();

    const fetchMock = vi.fn(
      async () => new Response("Service Unavailable", { status: 503 }),
    ) as unknown as typeof fetch;

    await expect(getGoogleAccessToken(env, fetchMock)).rejects.toMatchObject({
      code: "refresh_failed",
    });
    expect(getRow()?.status).toBe("connected");
  });
});
