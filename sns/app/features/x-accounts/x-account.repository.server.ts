import { getXAccount, listXAccounts } from "~/lib/db.server";
import type { XOAuthTransaction } from "./x-account.types";

export { getXAccount, listXAccounts };

export type RevokeXAccountRow = {
  accountId: string;
  chapterId: number;
  xUserId: string;
  now: string;
};

/**
 * Soft-revoke: sets `revoked_at`/`updated_at` and never deletes the row, because
 * `posts.x_account_id` keeps a foreign key to it. Returns the number of matched
 * rows so the caller can reject a mismatched confirmation.
 */
export async function revokeXAccountRow(
  db: D1Database,
  record: RevokeXAccountRow,
): Promise<number> {
  const result = await db
    .prepare(
      "UPDATE x_accounts SET revoked_at = ?, updated_at = ? WHERE id = ? AND chapter_id = ? AND x_user_id = ?",
    )
    .bind(record.now, record.now, record.accountId, record.chapterId, record.xUserId)
    .run();
  return result.meta.changes;
}

export type InsertOAuthTransactionRecord = {
  state: string;
  userId: string;
  chapterId: number;
  codeVerifier: string;
  returnTo: string;
  expiresAt: string;
  now: string;
};

export async function insertOAuthTransaction(
  db: D1Database,
  record: InsertOAuthTransactionRecord,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO oauth_transactions (state, provider, user_id, chapter_id, code_verifier, return_to, expires_at, created_at) VALUES (?, 'x', ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      record.state,
      record.userId,
      record.chapterId,
      record.codeVerifier,
      record.returnTo,
      record.expiresAt,
      record.now,
    )
    .run();
}

type OAuthTransactionRow = {
  user_id: string;
  chapter_id: number;
  code_verifier: string;
  return_to: string;
  expires_at: string;
};

/**
 * Reads the pending `provider = 'x'` transaction and deletes it in the same
 * step, so a replayed callback can never reuse it — matching the original
 * inline SELECT-then-DELETE.
 */
export async function takeOAuthTransaction(
  db: D1Database,
  state: string,
): Promise<XOAuthTransaction | null> {
  const row = await db
    .prepare(
      "SELECT user_id, chapter_id, code_verifier, return_to, expires_at FROM oauth_transactions WHERE state = ? AND provider = 'x'",
    )
    .bind(state)
    .first<OAuthTransactionRow>();
  await db.prepare("DELETE FROM oauth_transactions WHERE state = ?").bind(state).run();
  return row
    ? {
        userId: row.user_id,
        chapterId: row.chapter_id,
        codeVerifier: row.code_verifier,
        returnTo: row.return_to,
        expiresAt: row.expires_at,
      }
    : null;
}

export type UpsertXAccountRecord = {
  id: string;
  chapterId: number;
  xUserId: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  accessTokenExpiresAt: string | null;
  authorizedByUserId: string;
  now: string;
};

/**
 * Inserts the freshly authorized account, or — when this chapter already has a
 * row for the same X user — refreshes its profile/tokens and clears any prior
 * `revoked_at`, so reconnecting a revoked account reactivates the same row.
 */
export async function upsertXAccount(db: D1Database, record: UpsertXAccountRecord): Promise<void> {
  await db
    .prepare(
      "INSERT INTO x_accounts (id, chapter_id, x_user_id, username, display_name, profile_image_url, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, authorized_by_user_id, created_at, updated_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(chapter_id, x_user_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, profile_image_url = excluded.profile_image_url, access_token_ciphertext = excluded.access_token_ciphertext, refresh_token_ciphertext = excluded.refresh_token_ciphertext, access_token_expires_at = excluded.access_token_expires_at, authorized_by_user_id = excluded.authorized_by_user_id, updated_at = excluded.updated_at, revoked_at = NULL",
    )
    .bind(
      record.id,
      record.chapterId,
      record.xUserId,
      record.username,
      record.displayName,
      record.profileImageUrl,
      record.accessTokenCiphertext,
      record.refreshTokenCiphertext,
      record.accessTokenExpiresAt,
      record.authorizedByUserId,
      record.now,
      record.now,
    )
    .run();
}
