import { describe, expect, it } from "vitest";
import {
  type GoogleConnectionRow,
  getGoogleConnection,
  getGoogleConnectionSummary,
  markGoogleConnectionDisconnected,
  reencryptGoogleConnectionIfStale,
  upsertGoogleConnection,
} from "~/features/google/connection.server";
import {
  CURRENT_ENCRYPTION_KEY_VERSION,
  GOOGLE_CONNECTION_AAD,
  decryptRefreshToken,
} from "~/features/google/encryption.server";

function createFakeDb(initial: GoogleConnectionRow | null = null) {
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
            row = {
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
          if (sql.includes("SET status = 'disconnected'")) {
            const [last_error, updated_at] = args as [string, string];
            if (row) row = { ...row, status: "disconnected", last_error, updated_at };
            return { success: true, meta: {} };
          }
          if (sql.includes("SET refresh_token_ciphertext = ?")) {
            const [ciphertext, nonce, keyVersion, updated_at] = args as [
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
                updated_at,
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
  return { db: db as unknown as D1Database, getRow: () => row };
}

const TEST_ENV = {
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(13)).toString("base64"),
};

describe("connection.server", () => {
  it("未接続時は getGoogleConnectionSummary が unconnected を返す", async () => {
    const { db } = createFakeDb();
    expect(await getGoogleConnectionSummary(db)).toEqual({ status: "unconnected" });
  });

  it("upsert / disconnect / stale 鍵バージョンの再暗号化を行える", async () => {
    const { db, getRow } = createFakeDb();
    await upsertGoogleConnection(TEST_ENV, db, {
      email: "community-support@gdgoc.jp",
      googleUserId: "123456",
      refreshToken: "1//0g-token",
      scope: "https://www.googleapis.com/auth/drive openid email",
      connectedByUserId: "admin-1",
      now: new Date("2026-11-19T00:00:00.000Z"),
    });

    const summary = await getGoogleConnectionSummary(db);
    expect(summary).toMatchObject({
      status: "connected",
      email: "community-support@gdgoc.jp",
      googleUserId: "123456",
      scopes: ["https://www.googleapis.com/auth/drive", "openid", "email"],
    });

    await markGoogleConnectionDisconnected(db, "invalid_grant", new Date("2026-11-19T01:00:00Z"));
    expect(getRow()?.status).toBe("disconnected");
    expect(getRow()?.last_error).toBe("invalid_grant");

    const current = await getGoogleConnection(db);
    if (!current) throw new Error("unreachable");
    const stale = { ...current, encryption_key_version: 0 };
    await reencryptGoogleConnectionIfStale(TEST_ENV, db, stale, "1//0g-token");

    const updated = getRow();
    expect(updated?.encryption_key_version).toBe(CURRENT_ENCRYPTION_KEY_VERSION);
    const decrypted = await decryptRefreshToken(
      TEST_ENV,
      GOOGLE_CONNECTION_AAD,
      updated?.encryption_key_version ?? 0,
      updated?.refresh_token_ciphertext ?? "",
      updated?.refresh_token_nonce ?? "",
    );
    expect(decrypted).toBe("1//0g-token");
  });
});
