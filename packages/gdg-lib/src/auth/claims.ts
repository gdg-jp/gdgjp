export const CHAPTERS_SCOPE = "https://gdgs.jp/scopes/chapters";
export const CHAPTERS_CLAIM = "https://gdgs.jp/claims/chapters";
export const IS_ADMIN_CLAIM = "https://gdgs.jp/claims/is_admin";

/**
 * Accounts-issued cookie on the parent domain (`gdgs.jp`) carrying the public
 * ID of the browser's current IdP session. It is not a credential: relying
 * parties only compare it with the `sid` their own session was bound to.
 */
export const SSO_SESSION_COOKIE = "gdg_sid";
/** First-party session check: client credentials + `{ sid, sub }` → live claims. */
export const RP_SESSION_PATH = "/api/rp/v1/session";
