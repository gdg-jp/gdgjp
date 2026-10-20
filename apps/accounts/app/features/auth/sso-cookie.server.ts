import { SSO_SESSION_COOKIE } from "@gdgjp/gdg-lib/auth/claims";

/**
 * Keeps the parent-domain `gdg_sid` cookie in step with the browser's Better
 * Auth session, the way accounts.google.com keeps `*.google.com` informed.
 *
 * Relying parties bind their own session to the IdP session ID (`sid`) and
 * compare it with this cookie on every request, so signing out, switching
 * accounts or an expired IdP session is visible to every `*.gdgs.jp` app on
 * its next request. The value is the public session ID, never the session
 * token, so a relying party never receives an IdP credential.
 */

// Better Auth names its session cookie `<prefix>.session_token`, with the
// `__Secure-` prefix whenever the base URL is HTTPS.
const SESSION_COOKIE_NAMES = [
  "__Secure-gdgjp-accounts.session_token",
  "gdgjp-accounts.session_token",
] as const;

type SessionRow = { id: string; expiresAt: string };

export async function reconcileSsoCookie(
  env: Env,
  request: Request,
  response: Response,
): Promise<Response> {
  const issued = readIssuedSessionCookie(response);
  const presented = readPresentedSessionToken(request);

  let session: SessionRow | null;
  if (issued === "cleared") {
    session = null;
  } else if (issued) {
    // A different session replaced the presented one (signing in again or as
    // another user without signing out first). End the old session so its
    // OAuth grants are revoked instead of lingering beside the new one.
    if (presented && presented !== issued) await deleteSessionByToken(env.DB, presented);
    session = await findLiveSession(env.DB, issued);
  } else if (shouldCheckPresentedSession(request)) {
    session = presented ? await findLiveSession(env.DB, presented) : null;
  } else {
    return response;
  }

  const current = readCookie(request, SSO_SESSION_COOKIE);
  // Re-issue on every new session cookie so the hint's lifetime follows
  // Better Auth's sliding expiry.
  if (!issued && (session?.id ?? null) === current) return response;
  if (!session && current === null) return response;

  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", ssoCookie(env.APP_URL, session));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Navigations and OAuth endpoints are where a relying party may look next. */
function shouldCheckPresentedSession(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (new URL(request.url).pathname.startsWith("/api/auth/oauth2/")) return true;
  return request.headers.get("sec-fetch-mode") === "navigate";
}

async function findLiveSession(db: D1Database, token: string): Promise<SessionRow | null> {
  const row = await db
    .prepare('SELECT "id", "expiresAt" FROM "session" WHERE "token" = ? LIMIT 1')
    .bind(token)
    .first<SessionRow>();
  if (!row || !(Date.parse(row.expiresAt) > Date.now())) return null;
  return row;
}

async function deleteSessionByToken(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM "session" WHERE "token" = ?').bind(token).run();
}

function readIssuedSessionCookie(response: Response): string | "cleared" | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (!(SESSION_COOKIE_NAMES as readonly string[]).includes(name)) continue;
    const value = pair.slice(separator + 1).trim();
    const expired = attributes.some((attribute) => {
      const [key, raw = ""] = attribute.split("=");
      const lower = key.trim().toLowerCase();
      if (lower === "max-age") return Number(raw.trim()) <= 0;
      if (lower === "expires") return Date.parse(raw.trim()) <= Date.now();
      return false;
    });
    if (!value || expired) return "cleared";
    return sessionTokenFromCookieValue(value);
  }
  return null;
}

function readPresentedSessionToken(request: Request): string | null {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = readCookie(request, name);
    if (value) return sessionTokenFromCookieValue(value);
  }
  return null;
}

/** Better Auth signs the cookie as `<token>.<signature>`; D1 stores the token. */
function sessionTokenFromCookieValue(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const token = decoded.split(".")[0];
  return token ? token : null;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function ssoCookie(appUrl: string, session: SessionRow | null): string {
  const { hostname, protocol } = new URL(appUrl);
  const parts = [
    `${SSO_SESSION_COOKIE}=${session?.id ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  // Loopback cookies ignore the port, so a host-only cookie already reaches
  // every local relying party. Elsewhere, share it with sibling subdomains.
  const domain = parentDomain(hostname);
  if (domain) parts.push(`Domain=${domain}`);
  if (protocol === "https:") parts.push("Secure");
  const maxAge = session
    ? Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000))
    : 0;
  parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function parentDomain(hostname: string): string | null {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return null;
  const labels = hostname.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : null;
}
