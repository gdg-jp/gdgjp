import type { LinkRedis } from "../../lib/redis";
import type { ChatPlatform } from "../chat/platform";
import type { EncryptedPayload, TokenKeyring } from "./token-crypto";
export type { ChatPlatform, LinkRedis };
export type LinkAccountEnv = {
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
  ACCOUNTS_URL: string;
  TOKEN_ENCRYPTION_KEYS: string;
};

export type LinkStateRecord = {
  platform: ChatPlatform;
  chatUserId: string;
  codeVerifier: string;
  spaceId: string;
  createdAt: number;
};

export type StoredLinkRecord = {
  platform: ChatPlatform;
  chatUserId: string;
  accessToken: EncryptedPayload;
  /** Unix seconds. */
  accessTokenExpiresAt: number;
  refreshToken: EncryptedPayload;
  refreshLease?: {
    owner: string;
    expiresAt: number;
  };
  subject: string | null;
  linkedAt: number;
};

export type LinkedTokenOk = {
  status: "ok";
  accessToken: string;
};

export type LinkedTokenNeedsLink = {
  status: "needs_link";
  authorizationUrl: string;
};

export type LinkedTokenTemporarilyUnavailable = {
  status: "temporarily_unavailable";
};

export type LinkedTokenResult =
  | LinkedTokenOk
  | LinkedTokenNeedsLink
  | LinkedTokenTemporarilyUnavailable;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LinkAccountDeps = {
  env: LinkAccountEnv;
  redis: LinkRedis;
  fetch?: FetchLike;
  nowSeconds?: () => number;
  /** Override keyring parse (tests). */
  keyring?: TokenKeyring;
};
