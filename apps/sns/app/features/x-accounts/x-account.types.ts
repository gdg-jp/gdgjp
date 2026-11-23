export type XAccount = {
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
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

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

export type XAccountDependencies = {
  db: D1Database;
};

export type XOAuthDependencies = {
  db: D1Database;
  randomState: () => string;
  randomVerifier: () => string;
  authorizationUrl: (state: string, verifier: string) => Promise<string>;
  exchangeCode: (code: string, verifier: string) => Promise<XTokenExchange>;
  encryptToken: (plaintext: string) => Promise<string>;
  now: () => string;
};
