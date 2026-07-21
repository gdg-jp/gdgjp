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
import {
  type AuthUser,
  CHAPTERS_CLAIM,
  CHAPTERS_SCOPE,
  ClaimsUnavailableError,
  IS_ADMIN_CLAIM,
  type UserChapter,
  type UserClaims,
} from "./index";

// ─── Config ────────────────────────────────────────────────────────────────────

export interface RpAuthConfig {
  db: D1Database;
  appUrl: string;
  cookiePrefix: string;
  secret: string;
  idp: {
    url: string;
    clientId: string;
    clientSecret: string;
    /** Optional internal transport, such as a Cloudflare service binding. */
    fetch?: typeof fetch;
  };
}

export interface RpAuthInstance {
  getSessionUser(request: Request): Promise<AuthUser | null>;
  requireUser(request: Request): Promise<AuthUser>;
  handleAuthRequest(request: Request): Promise<Response>;
  handleSignOutRedirect(request: Request, options?: { returnTo?: string }): Promise<Response>;
  /**
   * Fetch the user's current claims from the IdP /userinfo endpoint.
   * Resolves access/refresh tokens from the server-side D1 session and refreshes
   * them when expired. Throws ClaimsUnavailableError if the login session is
   * absent, the refresh token is invalid, or /userinfo errors.
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
    handleAuthRequest: (request) => handleAuthRequest(config, request),
    handleSignOutRedirect: (request, options) => {
      const returnTo = safeReturnTo(options?.returnTo ?? "/signin", config.appUrl);
      return handleEndSession(config, request, returnTo);
    },
    getFreshClaims: (request) => fetchUserClaims(config, request),
  };
}

// ─── Discovery (cached per issuer URL) ─────────────────────────────────────────

const issuerCache = new Map<string, Promise<oidc.Configuration>>();
const OIDC_HTTP_TIMEOUT_S = 10;

function getIssuerConfig(config: RpAuthConfig): Promise<oidc.Configuration> {
  const key = `${config.idp.url}|${config.idp.clientId}`;
  let p = issuerCache.get(key);
  if (!p) {
    const issuerUrl = new URL(config.idp.url);
    // openid-client v6 rejects HTTP discovery URLs by default. Allow it for
    // localhost so RPs can talk to a `wrangler dev` IdP; production stays
    // HTTPS-only (the issuer URL comes from wrangler.toml [vars]).
    const isLocal = issuerUrl.protocol === "http:";
    const options: oidc.DiscoveryRequestOptions = {
      timeout: OIDC_HTTP_TIMEOUT_S,
      ...(config.idp.fetch
        ? {
            [oidc.customFetch]: config.idp.fetch as NonNullable<
              oidc.DiscoveryRequestOptions[typeof oidc.customFetch]
            >,
          }
        : {}),
      ...(isLocal ? { execute: [oidc.allowInsecureRequests] } : {}),
    };
    p = oidc
      .discovery(issuerUrl, config.idp.clientId, config.idp.clientSecret, undefined, options)
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
  version: 3;
  sessionId: string;
  userId: string;
  issuer: string;
  subject: string;
  email: string;
  name: string;
  picture: string | null;
  isAdmin: boolean;
  expiresAt: number;
}

interface TokenSessionRow {
  id: string;
  userId: string;
  issuer: string;
  subject: string;
  accessToken: string;
  refreshToken: string | null;
  idToken: string;
  accessTokenExpiresAt: number;
  expiresAt: number;
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
    return handleSignOut(config, request);
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
    scope: `openid email profile offline_access ${CHAPTERS_SCOPE}`,
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

  const idTokenClaims = tokens.claims();
  const oidcSub = idTokenClaims?.sub;
  if (!tokens.id_token || typeof oidcSub !== "string" || oidcSub.length === 0) {
    console.error("oidc callback returned no valid id_token subject");
    return new Response("Authentication failed", { status: 400 });
  }

  let userClaims: UserClaims;
  try {
    userClaims = await fetchUserinfoClaims(issuerConfig, tokens.access_token, oidcSub);
  } catch (err) {
    console.error("oidc userinfo failed", err);
    return new Response("Failed to fetch user info", { status: 400 });
  }

  const issuer = issuerConfig.serverMetadata().issuer;
  if (typeof issuer !== "string" || issuer.length === 0) {
    console.error("OIDC discovery metadata has no issuer");
    return new Response("Authentication failed", { status: 400 });
  }

  let internalUserId: string;
  try {
    internalUserId = await upsertUser(config.db, issuer, oidcSub, userClaims);
  } catch (err) {
    console.error("OIDC account linking failed", err);
    return new Response("Authentication failed", { status: 400 });
  }

  const sessionId = crypto.randomUUID();
  const sessionExpiresAt = Date.now() + SESSION_MAX_AGE_S * 1000;
  try {
    // Bound server-side token storage without requiring a scheduled cleanup job.
    await config.db
      .prepare("DELETE FROM oidc_session WHERE expires_at <= ?")
      .bind(Date.now())
      .run();
    await config.db
      .prepare(
        `INSERT INTO oidc_session
         (id, user_id, issuer, subject, access_token, refresh_token, id_token,
          access_token_expires_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
      )
      .bind(
        sessionId,
        internalUserId,
        issuer,
        oidcSub,
        tokens.access_token,
        tokens.refresh_token ?? null,
        tokens.id_token,
        Date.now() + (tokens.expires_in ?? 3600) * 1000,
        sessionExpiresAt,
      )
      .run();
  } catch (err) {
    console.error("OIDC session persistence failed", err);
    return new Response("Authentication failed", { status: 500 });
  }

  const session: SessionPayload = {
    version: 3,
    sessionId,
    userId: internalUserId,
    issuer,
    subject: oidcSub,
    email: userClaims.email ?? "",
    name: userClaims.name ?? userClaims.email ?? "",
    picture: userClaims.picture,
    isAdmin: userClaims.isAdmin,
    expiresAt: sessionExpiresAt,
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

async function handleSignOut(config: RpAuthConfig, request: Request): Promise<Response> {
  return handleEndSession(config, request, `${config.appUrl}/signin`);
}

async function handleEndSession(
  config: RpAuthConfig,
  request: Request,
  returnTo: string,
): Promise<Response> {
  const value = readCookie(request, sessionCookieName(config));
  const session = value ? await verifyPayload<SessionPayload>(value, config.secret) : null;
  let location = returnTo;

  const tokenSession = isCurrentSession(session, config)
    ? await readTokenSession(config.db, session.sessionId)
    : null;
  if (tokenSession) {
    await config.db.prepare("DELETE FROM oidc_session WHERE id = ?").bind(tokenSession.id).run();
    try {
      const issuerConfig = await getIssuerConfig(config);
      if (issuerConfig.serverMetadata().issuer === tokenSession.issuer) {
        location = oidc
          .buildEndSessionUrl(issuerConfig, {
            id_token_hint: tokenSession.idToken,
            post_logout_redirect_uri: returnTo,
          })
          .toString();
      }
    } catch (err) {
      console.warn("OIDC end-session endpoint unavailable; clearing local session", err);
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
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
  if (!isCurrentSession(session, config)) return null;
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
  const value = parseCookies(request.headers.get("cookie"))[sessionCookieName(config)];
  if (!value) throw new ClaimsUnavailableError("no_linked_account");
  const session = await verifyPayload<SessionPayload>(value, config.secret);
  if (!isCurrentSession(session, config)) throw new ClaimsUnavailableError("no_linked_account");

  // De-dupe refresh/userinfo work for this login within an isolate.
  const inflight = inflightClaims.get(session.sessionId);
  if (inflight) return inflight;

  const promise = (async () => {
    let issuerConfig: oidc.Configuration;
    try {
      issuerConfig = await getIssuerConfig(config);
    } catch (err) {
      throw new ClaimsUnavailableError("userinfo_failed", err);
    }
    let stored = await readTokenSession(config.db, session.sessionId);
    if (
      !stored ||
      stored.userId !== session.userId ||
      stored.issuer !== session.issuer ||
      stored.subject !== session.subject ||
      stored.expiresAt <= Date.now()
    ) {
      throw new ClaimsUnavailableError("no_linked_account");
    }
    if (stored.accessTokenExpiresAt - REFRESH_LEEWAY_MS < Date.now()) {
      stored = await refreshStoredTokens(config.db, issuerConfig, stored);
    }

    try {
      if (issuerConfig.serverMetadata().issuer !== session.issuer) {
        throw new ClaimsUnavailableError("userinfo_failed");
      }
      return await fetchUserinfoClaims(issuerConfig, stored.accessToken, session.subject);
    } catch (err) {
      if (err instanceof ClaimsUnavailableError) throw err;
      throw new ClaimsUnavailableError("userinfo_failed", err);
    }
  })().finally(() => inflightClaims.delete(session.sessionId));

  inflightClaims.set(session.sessionId, promise);
  return promise;
}

function isCurrentSession(
  session: SessionPayload | null,
  config: RpAuthConfig,
): session is SessionPayload {
  return (
    session?.version === 3 &&
    typeof session.sessionId === "string" &&
    session.sessionId.length > 0 &&
    typeof session.issuer === "string" &&
    session.issuer === trimTrailingSlash(config.idp.url) &&
    typeof session.subject === "string" &&
    session.subject.length > 0 &&
    typeof session.expiresAt === "number" &&
    session.expiresAt > Date.now()
  );
}

async function readTokenSession(db: D1Database, id: string): Promise<TokenSessionRow | null> {
  return db
    .prepare(
      `SELECT id, user_id AS userId, issuer, subject, access_token AS accessToken,
              refresh_token AS refreshToken, id_token AS idToken,
              access_token_expires_at AS accessTokenExpiresAt, expires_at AS expiresAt
       FROM oidc_session WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<TokenSessionRow>();
}

async function refreshStoredTokens(
  db: D1Database,
  issuerConfig: oidc.Configuration,
  current: TokenSessionRow,
): Promise<TokenSessionRow> {
  if (!current.refreshToken) throw new ClaimsUnavailableError("refresh_failed");

  let refreshed: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    refreshed = await oidc.refreshTokenGrant(issuerConfig, current.refreshToken);
  } catch (err) {
    // Another isolate may have completed refresh-token rotation first.
    const winner = await readTokenSession(db, current.id);
    if (
      winner?.refreshToken &&
      winner.refreshToken !== current.refreshToken &&
      winner.accessTokenExpiresAt - REFRESH_LEEWAY_MS >= Date.now()
    ) {
      return winner;
    }
    throw new ClaimsUnavailableError("refresh_failed", err);
  }

  const nextAccessExpiry = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
  const result = await db
    .prepare(
      `UPDATE oidc_session
       SET access_token = ?, refresh_token = ?, id_token = ?,
           access_token_expires_at = ?, updated_at = unixepoch()
       WHERE id = ? AND refresh_token = ?`,
    )
    .bind(
      refreshed.access_token,
      refreshed.refresh_token ?? current.refreshToken,
      refreshed.id_token ?? current.idToken,
      nextAccessExpiry,
      current.id,
      current.refreshToken,
    )
    .run();

  if (result.meta.changes !== 1) {
    const winner = await readTokenSession(db, current.id);
    if (winner) return winner;
    throw new ClaimsUnavailableError("refresh_failed");
  }
  return {
    ...current,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? current.refreshToken,
    idToken: refreshed.id_token ?? current.idToken,
    accessTokenExpiresAt: nextAccessExpiry,
  };
}

// ─── User upsert ───────────────────────────────────────────────────────────────

/** Resolve users by the stable OIDC identity. A verified email may link one
 * pre-OIDC row exactly once; it is never used as the ongoing identity key. */
async function upsertUser(
  db: D1Database,
  issuer: string,
  subject: string,
  claims: UserClaims,
): Promise<string> {
  const email = claims.email ?? "";
  const name = claims.name ?? email;
  const image = claims.picture;
  const isAdmin = claims.isAdmin ? 1 : 0;
  const now = Math.floor(Date.now() / 1000);

  const linked = await db
    .prepare(`SELECT id FROM "user" WHERE oidc_issuer = ? AND oidc_subject = ? LIMIT 1`)
    .bind(issuer, subject)
    .first<{ id: string }>();

  if (linked) {
    await db
      .prepare(`UPDATE "user" SET name = ?, image = ?, is_admin = ?, updated_at = ? WHERE id = ?`)
      .bind(name, image, isAdmin, now, linked.id)
      .run();
    return linked.id;
  }

  if (!email || !claims.emailVerified) {
    throw new Error("Cannot link a new OIDC identity without a verified email");
  }

  const existingByEmail = await db
    .prepare(`SELECT id, oidc_issuer, oidc_subject FROM "user" WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<{ id: string; oidc_issuer: string | null; oidc_subject: string | null }>();

  if (existingByEmail) {
    if (existingByEmail.oidc_issuer || existingByEmail.oidc_subject) {
      throw new Error("Email is already linked to a different OIDC identity");
    }
    const result = await db
      .prepare(
        `UPDATE "user"
         SET oidc_issuer = ?, oidc_subject = ?, name = ?, image = ?, is_admin = ?, updated_at = ?
         WHERE id = ? AND oidc_issuer IS NULL AND oidc_subject IS NULL`,
      )
      .bind(issuer, subject, name, image, isAdmin, now, existingByEmail.id)
      .run();
    if (result.meta.changes !== 1) {
      throw new Error("OIDC identity link changed concurrently");
    }
    return existingByEmail.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO "user"
       (id, email, name, image, is_admin, oidc_issuer, oidc_subject, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, email, name, image, isAdmin, issuer, subject, now, now)
    .run();
  return id;
}

// ─── /userinfo fetch ───────────────────────────────────────────────────────────

/**
 * Fetches the IdP's /userinfo endpoint and requires its `sub` to match the
 * subject of the validated ID Token, as required by OpenID Connect Core.
 */
async function fetchUserinfoClaims(
  issuerConfig: oidc.Configuration,
  accessToken: string,
  expectedSubject: string,
): Promise<UserClaims> {
  const claims = await oidc.fetchUserInfo(issuerConfig, accessToken, expectedSubject);
  return parseClaims(claims as Record<string, unknown>);
}

// ─── Claims parsing ────────────────────────────────────────────────────────────

function parseClaims(json: Record<string, unknown>): UserClaims {
  const namespacedChapters = json[CHAPTERS_CLAIM];
  const chapters: UserChapter[] = Array.isArray(namespacedChapters)
    ? (namespacedChapters as unknown[]).flatMap((entry) => {
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
  return {
    sub: typeof json.sub === "string" ? json.sub : "",
    email: typeof json.email === "string" ? json.email : null,
    name: typeof json.name === "string" ? json.name : null,
    picture: typeof json.picture === "string" ? json.picture : null,
    emailVerified: json.email_verified === true,
    isAdmin: json[IS_ADMIN_CLAIM] === true,
    chapter: chapters[0] ?? null,
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
