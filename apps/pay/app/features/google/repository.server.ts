import type {
  GoogleOAuthToken,
  GoogleOAuthTokenRow,
  OAuthTransaction,
  OAuthTransactionRow,
} from "./types";

function mapGoogleOAuthToken(row: GoogleOAuthTokenRow): GoogleOAuthToken {
  return {
    userId: row.user_id,
    googleEmail: row.google_email,
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    accessTokenExpiresAt: row.access_token_expires_at,
    templateGrantedAt: row.template_granted_at,
  };
}

export async function getGoogleOAuthToken(
  db: D1Database,
  userId: string,
): Promise<GoogleOAuthToken | null> {
  const row = await db
    .prepare("SELECT * FROM google_oauth_tokens WHERE user_id = ?")
    .bind(userId)
    .first<GoogleOAuthTokenRow>();
  return row ? mapGoogleOAuthToken(row) : null;
}

export async function upsertGoogleOAuthToken(
  db: D1Database,
  input: {
    userId: string;
    googleEmail: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    accessTokenExpiresAt: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO google_oauth_tokens (
         user_id, google_email, access_token_enc, refresh_token_enc, access_token_expires_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(user_id) DO UPDATE SET
         google_email = excluded.google_email,
         access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc,
         access_token_expires_at = excluded.access_token_expires_at,
         updated_at = unixepoch()`,
    )
    .bind(
      input.userId,
      input.googleEmail,
      input.accessTokenEnc,
      input.refreshTokenEnc,
      input.accessTokenExpiresAt,
    )
    .run();
}

export async function markTemplateGranted(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      "UPDATE google_oauth_tokens SET template_granted_at = unixepoch(), updated_at = unixepoch() WHERE user_id = ?",
    )
    .bind(userId)
    .run();
}

export async function insertOAuthTransaction(
  db: D1Database,
  input: {
    state: string;
    userId: string;
    eventId: string;
    codeVerifier: string;
    returnTo: string;
    ttlSeconds?: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_transactions (state, user_id, event_id, code_verifier, return_to, expires_at)
       VALUES (?, ?, ?, ?, ?, unixepoch() + ?)`,
    )
    .bind(
      input.state,
      input.userId,
      input.eventId,
      input.codeVerifier,
      input.returnTo,
      input.ttlSeconds ?? 600,
    )
    .run();
}

export async function consumeOAuthTransaction(
  db: D1Database,
  state: string,
): Promise<OAuthTransaction | null> {
  const row = await db
    .prepare("SELECT * FROM oauth_transactions WHERE state = ?")
    .bind(state)
    .first<OAuthTransactionRow>();
  if (!row) return null;
  await db.prepare("DELETE FROM oauth_transactions WHERE state = ?").bind(state).run();
  if (row.expires_at * 1000 < Date.now()) return null;
  return {
    state: row.state,
    userId: row.user_id,
    eventId: row.event_id,
    codeVerifier: row.code_verifier,
    returnTo: row.return_to,
    expiresAt: row.expires_at,
  };
}
