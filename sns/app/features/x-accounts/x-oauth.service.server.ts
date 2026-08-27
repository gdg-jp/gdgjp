import {
  insertOAuthTransaction,
  takeOAuthTransaction,
  upsertXAccount,
} from "./x-account.repository.server";
import type { XOAuthDependencies } from "./x-account.types";

/** Ten minutes, matching the original inline `x/connect` transaction lifetime. */
const TRANSACTION_TTL_MS = 10 * 60_000;

export class XOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XOAuthError";
  }
}

export type BeginXConnectParams = {
  userId: string;
  chapterId: number;
  /** Already passed through `safeReturnTo` by the caller. */
  returnTo: string;
};

/**
 * Persists a pending `provider = 'x'` OAuth transaction and returns the X
 * authorization URL to redirect the browser to.
 */
export async function beginXConnect(
  deps: XOAuthDependencies,
  params: BeginXConnectParams,
): Promise<{ authorizationUrl: string }> {
  const state = deps.randomState();
  const verifier = deps.randomVerifier();
  await insertOAuthTransaction(deps.db, {
    state,
    userId: params.userId,
    chapterId: params.chapterId,
    codeVerifier: verifier,
    returnTo: params.returnTo,
    expiresAt: new Date(Date.now() + TRANSACTION_TTL_MS).toISOString(),
    now: deps.now(),
  });
  return { authorizationUrl: await deps.authorizationUrl(state, verifier) };
}

export type CompleteXConnectParams = {
  state: string | null;
  code: string | null;
  userId: string;
  chapterId: number;
};

/**
 * Consumes the pending transaction, exchanges the authorization code, and
 * upserts the resulting X account for the chapter. Returns where the caller
 * should redirect. Throws {@link XOAuthError} with the same messages the inline
 * callback used for a missing response or an invalid/expired transaction.
 */
export async function completeXConnect(
  deps: XOAuthDependencies,
  params: CompleteXConnectParams,
): Promise<{ returnTo: string }> {
  if (!params.state || !params.code) throw new XOAuthError("Missing X OAuth response");

  const transaction = await takeOAuthTransaction(deps.db, params.state);
  if (
    !transaction ||
    transaction.userId !== params.userId ||
    transaction.chapterId !== params.chapterId ||
    new Date(transaction.expiresAt) < new Date()
  )
    throw new XOAuthError("Invalid or expired X OAuth transaction");

  const { token, user } = await deps.exchangeCode(params.code, transaction.codeVerifier);
  const now = deps.now();
  await upsertXAccount(deps.db, {
    id: crypto.randomUUID(),
    chapterId: transaction.chapterId,
    xUserId: user.id,
    username: user.username,
    displayName: user.name,
    profileImageUrl: user.profile_image_url ?? null,
    accessTokenCiphertext: await deps.encryptToken(token.access_token),
    refreshTokenCiphertext: token.refresh_token
      ? await deps.encryptToken(token.refresh_token)
      : null,
    accessTokenExpiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null,
    authorizedByUserId: params.userId,
    now,
  });
  return { returnTo: transaction.returnTo };
}
