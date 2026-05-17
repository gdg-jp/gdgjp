import type { D1Database } from "@cloudflare/workers-types";
import * as oidc from "openid-client";
import {
  clearedCookie,
  parseCookies,
  readCookie,
  serializeCookie,
  signPayload,
  verifyPayload,
} from "./cookie";
import { type AuthUser, ClaimsUnavailableError, type UserChapter, type UserClaims } from "./index";

// ─── Config ────────────────────────────────────────────────────────────────────

export interface RpAuthConfig {
  db: D1Database;
  appUrl: string;
  cookiePrefix: string;
  secret: string;
  idp: { url: string; clientId: string; clientSecret: string };
}

export interface RpAuthInstance {
  getSessionUser(request: Request): Promise<AuthUser | null>;
  requireUser(request: Request): Promise<AuthUser>;
  signOut(request: Request): Promise<Response>;
  handleAuthRequest(request: Request): Promise<Response>;
  handleSignOutRedirect(request: Request, options?: { returnTo?: string }): Response;
  handleSignOutIframe(request: Request): Promise<Response>;
  /**
   * Fetch the user's current claims from the IdP /userinfo endpoint.
   * Reads access/refresh tokens from the signed session cookie on the request;
   * refreshes via refresh_token when expired. Throws ClaimsUnavailableError if
   * the cookie is absent, the refresh token is invalid, or /userinfo errors.
   * Callers should catch and redirect to /signin to force re-auth.
   */
  getFreshClaims(request: Request): Promise<UserClaims>;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function initializeRpAuth(config: RpAuthConfig): RpAuthInstance {
  return {
    getSessionUser: (request) => getSessionUser(config, request),
    requireUser: async (request) => {
      const user = await getSessionUser(config, request);
      if (!user) throw new Response("Unauthorized", { status: 401 });
      return user;
    },
    signOut: async (_request) => {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": clearedCookie(sessionCookieName(config)),
        },
      });
    },
    handleAuthRequest: (request) => handleAuthRequest(config, request),
    handleSignOutRedirect: (_request, options) => {
      const returnTo = options?.returnTo ?? `${config.appUrl}/signin`;
      const location = `${config.idp.url}/auth/signout?return_to=${encodeURIComponent(returnTo)}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: location,
          "Set-Cookie": clearedCookie(sessionCookieName(config)),
        },
      });
    },
    handleSignOutIframe: async (request) => {
      const csp = frameAncestorsCsp(config.idp.url, request.url);
      const headers = new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": csp,
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": clearedCookie(sessionCookieName(config)),
      });
      return new Response("<!doctype html><meta charset=utf-8><title>ok</title>", {
        status: 200,
        headers,
      });
    },
    getFreshClaims: (request) => fetchUserClaims(config, request),
  };
}

// ─── Discovery (cached per issuer URL) ─────────────────────────────────────────

const issuerCache = new Map<string, Promise<oidc.Configuration>>();

function getIssuerConfig(config: RpAuthConfig): Promise<oidc.Configuration> {
  const key = `${config.idp.url}|${config.idp.clientId}`;
  let p = issuerCache.get(key);
  if (!p) {
    const issuerUrl = new URL(config.idp.url);
    // openid-client v6 rejects HTTP discovery URLs by default. Allow it for
    // localhost so RPs can talk to a `wrangler dev` IdP; production stays
    // HTTPS-only (the issuer URL comes from wrangler.toml [vars]).
    const isLocal = issuerUrl.protocol === "http:";
    p = oidc
      .discovery(
        issuerUrl,
        config.idp.clientId,
        config.idp.clientSecret,
        undefined,
        isLocal ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((err) => {
        issuerCache.delete(key);
        throw err;
      });
    issuerCache.set(key, p);
  }
  return p;
}

// ─── Cookie names ──────────────────────────────────────────────────────────────

function sessionCookieName(config: RpAuthConfig): string {
  return `${config.cookiePrefix}-session`;
}
function txCookieName(config: RpAuthConfig): string {
  return `${config.cookiePrefix}-oidc-tx`;
}

// ─── Session payload ───────────────────────────────────────────────────────────

interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  picture: string | null;
  isAdmin: boolean;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number;
  chapters: UserChapter[];
  // Cached chapters/claims valid until this epoch ms; refresh from /userinfo after.
  claimsCacheUntil: number;
}

interface TxPayload {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30d
const TX_MAX_AGE_S = 60 * 10; // 10m
const CLAIMS_CACHE_MS = 5 * 60 * 1000; // 5m
const REFRESH_LEEWAY_MS = 30_000;

// ─── Request handler ───────────────────────────────────────────────────────────

async function handleAuthRequest(config: RpAuthConfig, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/auth/signin") return handleSignIn(config, request, url);
  if (pathname === "/api/auth/callback/gdgjp" || pathname === "/api/auth/callback") {
    return handleCallback(config, request, url);
  }
  if (pathname === "/api/auth/signout" || pathname === "/api/auth/sign-out") {
    return handleSignOut(config);
  }
  if (pathname === "/api/auth/me") return handleMe(config, request);
  return new Response("Not found", { status: 404 });
}

async function handleSignIn(config: RpAuthConfig, _request: Request, url: URL): Promise<Response> {
  const returnTo = safeReturnTo(url.searchParams.get("return_to"), config.appUrl);
  const issuerConfig = await getIssuerConfig(config);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const authUrl = oidc.buildAuthorizationUrl(issuerConfig, {
    redirect_uri: callbackUrl(config),
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  const tx: TxPayload = {
    codeVerifier,
    state,
    nonce,
    returnTo,
    exp: Date.now() + TX_MAX_AGE_S * 1000,
  };
  const txCookie = serializeCookie({
    name: txCookieName(config),
    value: await signPayload(tx, config.secret),
    maxAge: TX_MAX_AGE_S,
    secure: !isLocalAppUrl(config.appUrl),
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": txCookie,
    },
  });
}

async function handleCallback(config: RpAuthConfig, request: Request, url: URL): Promise<Response> {
  const txValue = readCookie(request, txCookieName(config));
  if (!txValue) return new Response("Missing OIDC transaction cookie", { status: 400 });
  const tx = await verifyPayload<TxPayload>(txValue, config.secret);
  if (!tx || tx.exp < Date.now()) {
    return new Response("Invalid or expired OIDC transaction", { status: 400 });
  }

  const issuerConfig = await getIssuerConfig(config);
  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    // idTokenExpected: false — the accounts IdP (workers-oauth-provider) is
    // OAuth 2.1 only and doesn't issue id_tokens. We fetch user attributes
    // from /userinfo below instead. expectedNonce is dropped since there's
    // no id_token to validate the nonce against.
    tokens = await oidc.authorizationCodeGrant(issuerConfig, url, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      idTokenExpected: false,
    });
  } catch (err) {
    console.error("oidc callback failed", err);
    return new Response("Authentication failed", { status: 400 });
  }

  let userClaims: UserClaims;
  try {
    userClaims = await fetchUserinfoClaims(issuerConfig, tokens.access_token);
  } catch (err) {
    console.error("oidc userinfo failed", err);
    return new Response("Failed to fetch user info", { status: 400 });
  }

  const internalUserId = await upsertUser(config.db, userClaims);

  const session: SessionPayload = {
    userId: internalUserId,
    email: userClaims.email ?? "",
    name: userClaims.name ?? userClaims.email ?? "",
    picture: userClaims.picture,
    isAdmin: userClaims.isAdmin,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    chapters: userClaims.chapters,
    claimsCacheUntil: Date.now() + CLAIMS_CACHE_MS,
  };

  const headers = new Headers({ Location: tx.returnTo });
  headers.append(
    "Set-Cookie",
    serializeCookie({
      name: sessionCookieName(config),
      value: await signPayload(session, config.secret),
      maxAge: SESSION_MAX_AGE_S,
      secure: !isLocalAppUrl(config.appUrl),
    }),
  );
  headers.append("Set-Cookie", clearedCookie(txCookieName(config)));
  return new Response(null, { status: 302, headers });
}

async function handleSignOut(config: RpAuthConfig): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${config.idp.url}/auth/signout?return_to=${encodeURIComponent(`${config.appUrl}/signin`)}`,
      "Set-Cookie": clearedCookie(sessionCookieName(config)),
    },
  });
}

async function handleMe(config: RpAuthConfig, request: Request): Promise<Response> {
  const user = await getSessionUser(config, request);
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Session readers ───────────────────────────────────────────────────────────

async function getSessionUser(config: RpAuthConfig, request: Request): Promise<AuthUser | null> {
  const value = parseCookies(request.headers.get("cookie"))[sessionCookieName(config)];
  if (!value) return null;
  const session = await verifyPayload<SessionPayload>(value, config.secret);
  if (!session) return null;
  return {
    id: session.userId,
    email: session.email,
    name: session.name,
    image: session.picture,
    isAdmin: session.isAdmin === true,
  };
}

// ─── Live claims ───────────────────────────────────────────────────────────────

const inflightClaims = new Map<string, Promise<UserClaims>>();

async function fetchUserClaims(config: RpAuthConfig, request: Request): Promise<UserClaims> {
  // Read the signed session cookie for access/refresh tokens — the cookie is
  // the only source of truth (no DB-side token storage on the RP). We can't
  // write a new cookie back from here since this isn't a response context, so
  // a refreshed access_token is used in-memory for this call only; on next
  // sign-in / token expiry the user re-authorizes.
  const value = parseCookies(request.headers.get("cookie"))[sessionCookieName(config)];
  if (!value) throw new ClaimsUnavailableError("no_linked_account");
  const session = await verifyPayload<SessionPayload>(value, config.secret);
  if (!session) throw new ClaimsUnavailableError("no_linked_account");

  // De-dupe inflight requests by userId.
  const inflight = inflightClaims.get(session.userId);
  if (inflight) return inflight;

  const promise = (async () => {
    const issuerConfig = await getIssuerConfig(config);
    let accessToken = session.accessToken;
    if (accessToken && session.accessTokenExpiresAt - REFRESH_LEEWAY_MS < Date.now()) {
      accessToken = "";
    }
    if (!accessToken) {
      if (!session.refreshToken) throw new ClaimsUnavailableError("refresh_failed");
      try {
        const refreshed = await oidc.refreshTokenGrant(issuerConfig, session.refreshToken);
        accessToken = refreshed.access_token;
      } catch (err) {
        throw new ClaimsUnavailableError("refresh_failed", err);
      }
    }

    try {
      // fetchProtectedResource, not fetchUserInfo: the latter validates that
      // the returned `sub` matches an expected subject, but our session.userId
      // is an RP-local UUID (minted by upsertUser via email lookup) while the
      // IdP keys /userinfo by its own internal sub. We already trust the
      // response via the bearer token we obtained from the same IdP, so
      // skipping the sub-equality check is safe.
      return await fetchUserinfoClaims(issuerConfig, accessToken);
    } catch (err) {
      if (err instanceof ClaimsUnavailableError) throw err;
      throw new ClaimsUnavailableError("userinfo_failed", err);
    }
  })().finally(() => inflightClaims.delete(session.userId));

  inflightClaims.set(session.userId, promise);
  return promise;
}

// ─── User upsert ───────────────────────────────────────────────────────────────

/**
 * Upserts the local user row by email. Returns the internal user.id (which
 * we want to be stable for existing users — so we look up by email rather
 * than trusting the IdP's `sub` to match our DB's id). For new users we
 * mint a fresh UUID.
 *
 * Writes against the post-PR-2 simplified schema (snake_case, no
 * emailVerified column).
 */
async function upsertUser(db: D1Database, claims: UserClaims): Promise<string> {
  const email = claims.email ?? "";
  const name = claims.name ?? email;
  const image = claims.picture;
  const isAdmin = claims.isAdmin ? 1 : 0;
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .prepare(`SELECT id FROM "user" WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(`UPDATE "user" SET name = ?, image = ?, is_admin = ?, updated_at = ? WHERE id = ?`)
      .bind(name, image, isAdmin, now, existing.id)
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO "user" (id, email, name, image, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, email, name, image, isAdmin, now, now)
    .run();
  return id;
}

// ─── /userinfo fetch ───────────────────────────────────────────────────────────

/**
 * Fetches the IdP's /userinfo endpoint with the given access token and parses
 * the response into UserClaims. Uses oidc.fetchProtectedResource (which does
 * not enforce a `sub` equality check) — the bearer token already authorises
 * the call, and our local user.id is not the IdP's sub.
 */
async function fetchUserinfoClaims(
  issuerConfig: oidc.Configuration,
  accessToken: string,
): Promise<UserClaims> {
  const userinfoEndpoint = issuerConfig.serverMetadata().userinfo_endpoint;
  if (!userinfoEndpoint) {
    throw new ClaimsUnavailableError("userinfo_failed");
  }
  const res = await oidc.fetchProtectedResource(
    issuerConfig,
    accessToken,
    new URL(userinfoEndpoint),
    "GET",
  );
  if (!res.ok) throw new ClaimsUnavailableError("userinfo_failed");
  const json = (await res.json()) as Record<string, unknown>;
  return parseClaims(json);
}

// ─── Claims parsing ────────────────────────────────────────────────────────────

function parseClaims(json: Record<string, unknown>): UserClaims {
  const role = json.chapterRole;
  const chapter: UserChapter | null =
    typeof json.chapterId === "number" &&
    typeof json.chapterSlug === "string" &&
    (role === "organizer" || role === "member")
      ? { chapterId: json.chapterId, chapterSlug: json.chapterSlug, role }
      : null;
  const parsedArray: UserChapter[] = Array.isArray(json.chapters)
    ? (json.chapters as unknown[]).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const e = entry as Record<string, unknown>;
        const r = e.role;
        if (
          typeof e.chapterId === "number" &&
          typeof e.chapterSlug === "string" &&
          (r === "organizer" || r === "member")
        ) {
          return [{ chapterId: e.chapterId, chapterSlug: e.chapterSlug, role: r }];
        }
        return [];
      })
    : [];
  const chapters: UserChapter[] = parsedArray.length ? parsedArray : chapter ? [chapter] : [];
  return {
    sub: typeof json.sub === "string" ? json.sub : "",
    email: typeof json.email === "string" ? json.email : null,
    name: typeof json.name === "string" ? json.name : null,
    picture: typeof json.picture === "string" ? json.picture : null,
    emailVerified: json.email_verified === true,
    isAdmin: json.isAdmin === true,
    chapter,
    chapters,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function callbackUrl(config: RpAuthConfig): string {
  return `${trimTrailingSlash(config.appUrl)}/api/auth/callback/gdgjp`;
}

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function isLocalAppUrl(appUrl: string): boolean {
  try {
    const u = new URL(appUrl);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function safeReturnTo(value: string | null, appUrl: string): string {
  if (!value) return new URL("/", appUrl).toString();
  try {
    // Only allow same-origin paths/URLs.
    const u = new URL(value, appUrl);
    if (u.origin === new URL(appUrl).origin) return u.toString();
  } catch {}
  return new URL("/", appUrl).toString();
}

function frameAncestorsCsp(idpUrl: string | undefined, requestUrl: string): string {
  if (!idpUrl) return "frame-ancestors 'self'";
  try {
    return `frame-ancestors 'self' ${new URL(idpUrl).origin}`;
  } catch {
    console.warn("rp signout-iframe: invalid IDP URL", { idpUrl, requestUrl });
    return "frame-ancestors 'self'";
  }
}
