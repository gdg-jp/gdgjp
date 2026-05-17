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
  getFreshClaims(userId: string): Promise<UserClaims>;
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
    getFreshClaims: (userId) => fetchUserClaims(config, userId),
  };
}

// ─── Discovery (cached per issuer URL) ─────────────────────────────────────────

const issuerCache = new Map<string, Promise<oidc.Configuration>>();

function getIssuerConfig(config: RpAuthConfig): Promise<oidc.Configuration> {
  const key = `${config.idp.url}|${config.idp.clientId}`;
  let p = issuerCache.get(key);
  if (!p) {
    p = oidc
      .discovery(new URL(config.idp.url), config.idp.clientId, config.idp.clientSecret)
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
    tokens = await oidc.authorizationCodeGrant(issuerConfig, url, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    });
  } catch (err) {
    console.error("oidc callback failed", err);
    return new Response("Authentication failed", { status: 400 });
  }

  const claims = tokens.claims();
  if (!claims?.sub) return new Response("Missing id_token claims", { status: 400 });
  const userClaims = parseIdTokenClaims(claims);

  await upsertUser(config.db, userClaims);

  const session: SessionPayload = {
    userId: userClaims.sub,
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
    isAdmin: session.isAdmin === true,
  };
}

// ─── Live claims ───────────────────────────────────────────────────────────────

const inflightClaims = new Map<string, Promise<UserClaims>>();

async function fetchUserClaims(config: RpAuthConfig, userId: string): Promise<UserClaims> {
  const inflight = inflightClaims.get(userId);
  if (inflight) return inflight;

  const promise = (async () => {
    // Read tokens from the user row's `account` table — for PR 1 the schema
    // hasn't changed yet, so the same account row better-auth wrote remains
    // available. PR 2 will move this into the session cookie itself.
    const row = await config.db
      .prepare(
        `SELECT accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt
         FROM account WHERE userId = ? AND providerId = 'gdgjp' LIMIT 1`,
      )
      .bind(userId)
      .first<{
        accessToken: string | null;
        refreshToken: string | null;
        accessTokenExpiresAt: string | null;
        refreshTokenExpiresAt: string | null;
      }>();
    if (!row) throw new ClaimsUnavailableError("no_linked_account");

    const issuerConfig = await getIssuerConfig(config);
    let accessToken = row.accessToken;
    const accessExp = row.accessTokenExpiresAt ? Date.parse(row.accessTokenExpiresAt) : 0;
    if (!accessToken || Number.isNaN(accessExp) || accessExp - REFRESH_LEEWAY_MS < Date.now()) {
      if (!row.refreshToken) throw new ClaimsUnavailableError("refresh_failed");
      try {
        const refreshed = await oidc.refreshTokenGrant(issuerConfig, row.refreshToken);
        accessToken = refreshed.access_token;
        const accessExpiresAt = new Date(
          Date.now() + (refreshed.expires_in ?? 3600) * 1000,
        ).toISOString();
        await config.db
          .prepare(
            `UPDATE account
             SET accessToken = ?, refreshToken = COALESCE(?, refreshToken),
                 accessTokenExpiresAt = ?, updatedAt = ?
             WHERE userId = ? AND providerId = 'gdgjp'`,
          )
          .bind(
            accessToken,
            refreshed.refresh_token ?? null,
            accessExpiresAt,
            new Date().toISOString(),
            userId,
          )
          .run();
      } catch (err) {
        throw new ClaimsUnavailableError("refresh_failed", err);
      }
    }

    try {
      const info = await oidc.fetchUserInfo(issuerConfig, accessToken, userId);
      return parseUserInfoClaims(info as Record<string, unknown>);
    } catch (err) {
      throw new ClaimsUnavailableError("userinfo_failed", err);
    }
  })().finally(() => inflightClaims.delete(userId));

  inflightClaims.set(userId, promise);
  return promise;
}

// ─── User upsert ───────────────────────────────────────────────────────────────

async function upsertUser(db: D1Database, claims: UserClaims): Promise<void> {
  const now = new Date().toISOString();
  // PR 1: write to the existing better-auth user table shape.
  // (createdAt only on initial insert; updatedAt always.)
  await db
    .prepare(
      `INSERT INTO "user" (id, email, name, emailVerified, image, isAdmin, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         emailVerified = excluded.emailVerified,
         image = excluded.image,
         isAdmin = excluded.isAdmin,
         updatedAt = excluded.updatedAt`,
    )
    .bind(
      claims.sub,
      claims.email ?? "",
      claims.name ?? claims.email ?? "",
      claims.emailVerified ? 1 : 0,
      claims.picture,
      claims.isAdmin ? 1 : 0,
      now,
      now,
    )
    .run();
}

// ─── Claims parsing ────────────────────────────────────────────────────────────

function parseIdTokenClaims(claims: Record<string, unknown>): UserClaims {
  return parseClaims(claims);
}

function parseUserInfoClaims(json: Record<string, unknown>): UserClaims {
  return parseClaims(json);
}

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
