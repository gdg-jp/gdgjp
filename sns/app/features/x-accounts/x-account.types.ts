export type { XAccount } from "~/lib/db.server";

/**
 * A usable X account, safe to hand to a dashboard loader or the CLI: it carries
 * only identity/metadata, never the encrypted access/refresh tokens.
 */
export type XAccountSummary = {
  id: string;
  chapterId: number;
  xUserId: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
  authorizedByUserId: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

/** The `oauth_transactions` row for an in-flight `provider = 'x'` connect. */
export type XOAuthTransaction = {
  userId: string;
  chapterId: number;
  codeVerifier: string;
  returnTo: string;
  expiresAt: string;
};

export type XTokenExchange = {
  token: { access_token: string; refresh_token?: string; expires_in?: number };
  user: { id: string; username: string; name: string; profile_image_url?: string };
};

/** Repository/service surface for listing and revoking existing X accounts. */
export type XAccountDependencies = {
  db: D1Database;
};

/**
 * The OAuth-transaction service is kept free of `Env`/crypto/`fetch`: state and
 * verifier generation, the X authorization URL, the code exchange, and token
 * encryption are all injected.
 */
export type XOAuthDependencies = {
  db: D1Database;
  randomState: () => string;
  randomVerifier: () => string;
  authorizationUrl: (state: string, verifier: string) => Promise<string>;
  exchangeCode: (code: string, verifier: string) => Promise<XTokenExchange>;
  encryptToken: (plaintext: string) => Promise<string>;
  now: () => string;
};
