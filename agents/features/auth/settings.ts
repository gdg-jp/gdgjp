import { CHAPTERS_SCOPE } from "@gdgjp/gdg-lib/auth/claims";
/** Must match the seeded agents client redirect URI byte for byte. */
export const REDIRECT_URI = "https://agent.gdgs.jp/auth/callback";

export const STATE_TTL_SECONDS = 10 * 60;
export const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60;
export const REFRESH_LEASE_SECONDS = 30;

export const OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  CHAPTERS_SCOPE,
] as const;

export const LINK_RECORD_TTL_SECONDS = 2592000 + 86400;
