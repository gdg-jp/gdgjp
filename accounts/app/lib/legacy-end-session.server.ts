interface OAuthClientRow {
  disabled: number;
  enableEndSession: number;
  postLogoutRedirectUris: string | null;
}

interface SignOutResponse {
  headers: Headers;
}

/**
 * Completes logout for ID tokens issued before first-party clients started
 * receiving a session ID (`sid`) claim. The provider cannot revoke the IdP
 * session from those tokens and otherwise turns the request into a 500.
 */
export async function handleLegacyEndSession(
  db: D1Database,
  request: Request,
  signOut: (headers: Headers) => Promise<SignOutResponse>,
): Promise<Response | null> {
  const url = new URL(request.url);
  const token = url.searchParams.get("id_token_hint");
  const claims = token ? readJwtClaims(token) : null;

  // Tokens carrying sid are handled (and fully verified) by Better Auth.
  if (!claims || typeof claims.sid === "string") return null;
  const clientId = typeof claims.aud === "string" ? claims.aud : null;
  const returnTo = url.searchParams.get("post_logout_redirect_uri");
  if (!clientId || !returnTo) return null;

  const client = await db
    .prepare(
      `SELECT disabled, enableEndSession, postLogoutRedirectUris
       FROM oauthClient WHERE clientId = ? LIMIT 1`,
    )
    .bind(clientId)
    .first<OAuthClientRow>();
  if (
    !client ||
    client.disabled !== 0 ||
    client.enableEndSession !== 1 ||
    !allowsPostLogoutRedirect(client.postLogoutRedirectUris, returnTo)
  ) {
    return null;
  }

  const response = await signOut(request.headers);
  const location = new URL(returnTo);
  const state = url.searchParams.get("state");
  if (state) location.searchParams.set("state", state);

  const headers = new Headers({ Location: location.toString() });
  for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * Better Auth has already verified the ID token before emitting this error.
 *
 * Its error serializer has changed shape between releases (and may also be
 * changed by framework middleware), so do not couple the recovery path to a
 * particular JSON property.  The exact diagnostic is emitted only after the
 * provider has validated the signed ID token.
 */
export async function isMissingSessionError(response: Response): Promise<boolean> {
  if (response.status !== 500) return false;
  try {
    return (await response.clone().text()).includes("id token missing session");
  } catch {
    return false;
  }
}

function readJwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function allowsPostLogoutRedirect(value: string | null, returnTo: string): boolean {
  try {
    const uris: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(uris) && uris.includes(returnTo);
  } catch {
    return false;
  }
}
