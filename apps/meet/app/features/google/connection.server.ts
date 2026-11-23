import {
  CURRENT_ENCRYPTION_KEY_VERSION,
  GOOGLE_CONNECTION_AAD,
  type GoogleEncryptionEnv,
  encryptRefreshToken,
} from "~/features/google/encryption.server";

export const GOOGLE_CONNECTION_ID = 1;

export type GoogleConnectionStatus = "connected" | "disconnected";

export type GoogleConnectionRow = {
  id: number;
  email: string;
  google_user_id: string;
  refresh_token_ciphertext: string;
  refresh_token_nonce: string;
  encryption_key_version: number;
  scope: string;
  connected_by_user_id: string;
  connected_at: string;
  updated_at: string;
  status: GoogleConnectionStatus;
  last_error: string | null;
};

export type GoogleConnectionSummary =
  | { status: "unconnected" }
  | {
      status: GoogleConnectionStatus;
      email: string;
      googleUserId: string;
      scopes: string[];
      connectedByUserId: string;
      connectedAt: string;
      updatedAt: string;
      lastError: string | null;
    };

export async function getGoogleConnection(db: D1Database): Promise<GoogleConnectionRow | null> {
  const row = await db
    .prepare(
      `SELECT id, email, google_user_id, refresh_token_ciphertext, refresh_token_nonce,
              encryption_key_version, scope, connected_by_user_id, connected_at, updated_at,
              status, last_error
       FROM google_connection WHERE id = ?`,
    )
    .bind(GOOGLE_CONNECTION_ID)
    .first<GoogleConnectionRow>();
  return row ?? null;
}

type GoogleConnectionSummaryRow = Omit<
  GoogleConnectionRow,
  "id" | "refresh_token_ciphertext" | "refresh_token_nonce" | "encryption_key_version"
>;

export async function getGoogleConnectionSummary(db: D1Database): Promise<GoogleConnectionSummary> {
  const row = await db
    .prepare(
      `SELECT email, google_user_id, scope, connected_by_user_id, connected_at, updated_at,
              status, last_error
       FROM google_connection WHERE id = ?`,
    )
    .bind(GOOGLE_CONNECTION_ID)
    .first<GoogleConnectionSummaryRow>();
  if (!row) return { status: "unconnected" };
  return {
    status: row.status,
    email: row.email,
    googleUserId: row.google_user_id,
    scopes: row.scope.split(/\s+/).filter(Boolean),
    connectedByUserId: row.connected_by_user_id,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

export async function upsertGoogleConnection(
  env: GoogleEncryptionEnv,
  db: D1Database,
  params: {
    email: string;
    googleUserId: string;
    refreshToken: string;
    scope: string;
    connectedByUserId: string;
    now?: Date;
  },
): Promise<void> {
  const { ciphertext, nonce, keyVersion } = await encryptRefreshToken(
    env,
    GOOGLE_CONNECTION_AAD,
    params.refreshToken,
  );
  const timestamp = (params.now ?? new Date()).toISOString();
  await db
    .prepare(
      `INSERT INTO google_connection
         (id, email, google_user_id, refresh_token_ciphertext, refresh_token_nonce,
          encryption_key_version, scope, connected_by_user_id, connected_at, updated_at,
          status, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', NULL)
       ON CONFLICT (id) DO UPDATE SET
         email = excluded.email,
         google_user_id = excluded.google_user_id,
         refresh_token_ciphertext = excluded.refresh_token_ciphertext,
         refresh_token_nonce = excluded.refresh_token_nonce,
         encryption_key_version = excluded.encryption_key_version,
         scope = excluded.scope,
         connected_by_user_id = excluded.connected_by_user_id,
         connected_at = excluded.connected_at,
         updated_at = excluded.updated_at,
         status = 'connected',
         last_error = NULL`,
    )
    .bind(
      GOOGLE_CONNECTION_ID,
      params.email,
      params.googleUserId,
      ciphertext,
      nonce,
      keyVersion,
      params.scope,
      params.connectedByUserId,
      timestamp,
      timestamp,
    )
    .run();
}

export async function markGoogleConnectionDisconnected(
  db: D1Database,
  lastError: string,
  now = new Date(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE google_connection
       SET status = 'disconnected', last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(lastError, now.toISOString(), GOOGLE_CONNECTION_ID)
    .run();
}

export async function reencryptGoogleConnectionIfStale(
  env: GoogleEncryptionEnv,
  db: D1Database,
  connection: GoogleConnectionRow,
  refreshToken: string,
  now = new Date(),
): Promise<void> {
  if (connection.encryption_key_version === CURRENT_ENCRYPTION_KEY_VERSION) return;
  const { ciphertext, nonce, keyVersion } = await encryptRefreshToken(
    env,
    GOOGLE_CONNECTION_AAD,
    refreshToken,
  );
  await db
    .prepare(
      `UPDATE google_connection
       SET refresh_token_ciphertext = ?, refresh_token_nonce = ?,
           encryption_key_version = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(ciphertext, nonce, keyVersion, now.toISOString(), GOOGLE_CONNECTION_ID)
    .run();
}
