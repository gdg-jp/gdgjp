import type { D1Database } from "@cloudflare/workers-types";
import * as oidc from "openid-client";
import { RP_SESSION_PATH, SSO_SESSION_COOKIE } from "./claims";
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
  type ChapterRole,
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
    /**
     * Transport for every IdP call, normally the `ACCOUNTS` service binding.
     * The session is checked against the IdP on each authenticated request, so
     * this must not leave Cloudflare's network.
     */
    fetch: typeof fetch;
  };
}

export interface RpAuthInstance {
  /**
   * The signed-in user, checked against the IdP for this request: null when
   * there is no session, when accounts.gdgs.jp now has another (or no) user
   * signed in, or when the IdP session ended. Throws a 503 Response when the
   * IdP cannot be asked (fail closed).
   */
  getSessionUser(request: Request): Promise<AuthUser | null>;
  requireUser(request: Request): Promise<AuthUser>;
  handleAuthRequest(request: Request): Promise<Response>;
  handleSignOutRedirect(request: Request, options?: { returnTo?: string }): Promise<Response>;
  /**
   * The user's current claims from the same per-request IdP check as
   * `getSessionUser`. Throws ClaimsUnavailableError("no_linked_account") when
   * the session is not valid; callers redirect to /signin.
   */
  getFreshClaims(request: Request): Promise<UserClaims>;
  /**
   * Returns a current OAuth access token for server-to-server calls to the IdP.
   * The token remains server-side and is refreshed when necessary.
   */
  getAccessToken(request: Request): Promise<string>;
  /**
   * Local-development and e2e sign-in without the IdP:
   * `/dev/login?as=<name>&chapter=<id>:<slug>[:<role>]&admin=1&return_to=/path`.
   * `chapter` may repeat (`chapter=none` for no membership). Answers 404
   * unless the app runs on a loopback URL; dev sessions are ignored elsewhere.
   */
  handleDevLogin(request: Request): Promise<Response>;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function initializeRpAuth(config: RpAuthConfig): RpAuthInstance {
  const verified = new WeakMap<Request, Promise<VerifiedSession | null>>();
  const verify = (request: Request) => {
    let pending = verified.get(request);
    if (!pending) {
      pending = verifySession(config, request);
      verified.set(request, pending);
    }
    return pending;
  };

  return {
    getSessionUser: async (request) => {
      const session = await verify(request);
      return session ? toAuthUser(session) : null;
    },
    requireUser: async (request) => {
      const session = await verify(request);
      if (!session) throw new Response("Unauthorized", { status: 401 });
      return toAuthUser(session);
    },
    handleAuthRequest: (request) => handleAuthRequest(config, request),
    handleSignOutRedirect: (request, options) => {
      const returnTo = safeReturnTo(options?.returnTo ?? "/signin", config.appUrl);
      return handleEndSession(config, request, returnTo);
    },
    getFreshClaims: async (request) => {
      const session = await verify(request);
      if (!session) throw new ClaimsUnavailableError("no_linked_account");
      return session.claims;
    },
    getAccessToken: async (request) => {
      const session = await verify(request);
      if (!session || session.payload.dev) throw new ClaimsUnavailableError("no_linked_account");
      return fetchAccessToken(config, session.payload);
    },
    handleDevLogin: (request) => handleDevLogin(config, request),
  };
}

// ─── Discovery (cached per issuer URL) ─────────────────────────────────────────

const issuerCache = new Map<string, Promise<oidc.Configuration>>();
const OIDC_HTTP_TIMEOUT_S = 10;
// The session check runs on every authenticated request; fail fast.
const SESSION_CHECK_TIMEOUT_MS = 3_000;

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
      [oidc.customFetch]: config.idp.fetch as NonNullable<
        oidc.DiscoveryRequestOptions[typeof oidc.customFetch]
      >,
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

/**
 * The RP cookie only names the login: identity and claims are asked of the
 * IdP on every request, so nothing here can go stale.
 */
interface SessionPayload {
  version: 4;
  sessionId: string;
  userId: string;
  issuer: string;
  subject: string;
  /** IdP session ID (`sid`) this login is bound to; compared with `gdg_sid`. */
  sid: string;
  expiresAt: number;
  /** Present only on `/dev/login` sessions, which skip the IdP (loopback only). */
  dev?: DevClaims;
}

interface DevClaims {
  email: string;
  name: string;
  isAdmin: boolean;
  chapters: UserChapter[];
}

interface VerifiedSession {
  payload: SessionPayload;
  claims: UserClaims;
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
// Marks the `state` of a sign-in that was restarted after a lost transaction
// cookie, so a browser that never stores the cookie is not redirected forever.
const RETRY_STATE_PREFIX = "retry.";

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
  const isRetry = url.searchParams.get("retry") === "1";
  const state = `${isRetry ? RETRY_STATE_PREFIX : ""}${oidc.randomState()}`;
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
  const tx = txValue ? await verifyPayload<TxPayload>(txValue, config.secret) : null;
  if (!tx || tx.exp < Date.now()) return handleLostTransaction(config, url);

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
  const sid = idTokenClaims?.sid;
  if (typeof sid !== "string" || sid.length === 0) {
    console.error("oidc callback returned an id_token without a session ID (sid)");
    return new Response("Authentication failed", { status: 400 });
  }
  // The IdP sets `gdg_sid` on the authorize response that led here. If the
  // browser still does not present it, every request would look signed out
  // and bounce through sign-in forever; stop with an explanation instead.
  if (readCookie(request, SSO_SESSION_COOKIE) !== sid) {
    return signInFailedPage(config, txCookieName(config), 409);
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
    version: 4,
    sessionId,
    userId: internalUserId,
    issuer,
    subject: oidcSub,
    sid,
    expiresAt: sessionExpiresAt,
  };

  const headers = new Headers({ Location: tx.returnTo });
  headers.append("Set-Cookie", await sessionCookie(config, session));
  headers.append("Set-Cookie", clearedCookie(txCookieName(config)));
  return new Response(null, { status: 302, headers });
}

/**
 * The callback arrived without a usable transaction cookie: the 10-minute
 * window passed on the IdP login screen, or the flow started in one cookie jar
 * (e.g. a chat app's in-app browser) and finished in another (Safari). The
 * user usually now has an IdP session in this browser, so restarting sign-in
 * here completes without another prompt. The original return_to is lost with
 * the cookie, so the restart lands on the app root.
 */
function handleLostTransaction(config: RpAuthConfig, url: URL): Response {
  const state = url.searchParams.get("state") ?? "";
  if (url.searchParams.has("error") || state.startsWith(RETRY_STATE_PREFIX)) {
    return signInFailedPage(config, txCookieName(config), 400);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${trimTrailingSlash(config.appUrl)}/api/auth/signin?retry=1`,
      "Set-Cookie": clearedCookie(txCookieName(config)),
    },
  });
}

function signInFailedPage(config: RpAuthConfig, clearCookie: string, status: number): Response {
  const signIn = escapeHtml(`${trimTrailingSlash(config.appUrl)}/api/auth/signin`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>サインインできませんでした</title><p>サインインを完了できませんでした。ブラウザで Cookie が有効になっているか確認してから、<a href="${signIn}">もう一度サインイン</a>してください。</p>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": clearedCookie(clearCookie),
      },
    },
  );
}

async function handleSignOut(config: RpAuthConfig, request: Request): Promise<Response> {
  return handleEndSession(config, request, `${config.appUrl}/signin`);
}

async function handleEndSession(
  config: RpAuthConfig,
  request: Request,
  returnTo: string,
): Promise<Response> {
  const session = await readSessionPayload(config, request);
  let location = returnTo;

  const tokenSession =
    session && !session.dev ? await readTokenSession(config.db, session.sessionId) : null;
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
  const session = await verifySession(config, request);
  return new Response(JSON.stringify({ user: session ? toAuthUser(session) : null }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ─── Session verification ──────────────────────────────────────────────────────

async function readSessionPayload(
  config: RpAuthConfig,
  request: Request,
): Promise<SessionPayload | null> {
  const value = parseCookies(request.headers.get("cookie"))[sessionCookieName(config)];
  if (!value) return null;
  const session = await verifyPayload<SessionPayload>(value, config.secret);
  return isCurrentSession(session, config) ? session : null;
}

/**
 * Accounts.gdgs.jp is the only source of truth for who is signed in: the RP
 * session must still be bound to the browser's current IdP session (`gdg_sid`),
 * and that session must still be alive. Claims come from the same answer.
 */
async function verifySession(
  config: RpAuthConfig,
  request: Request,
): Promise<VerifiedSession | null> {
  const payload = await readSessionPayload(config, request);
  if (!payload) return null;

  if (payload.dev) {
    if (!isLocalAppUrl(config.appUrl)) return null;
    return { payload, claims: devUserClaims(payload, payload.dev) };
  }

  if (readCookie(request, SSO_SESSION_COOKIE) !== payload.sid) return null;

  const claims = await checkIdpSession(config, payload);
  if (!claims) {
    // The IdP session is gone; its tokens were revoked with it.
    await config.db.prepare("DELETE FROM oidc_session WHERE id = ?").bind(payload.sessionId).run();
    return null;
  }
  await syncDisplayProfile(config.db, payload.userId, claims);
  return { payload, claims };
}

async function checkIdpSession(
  config: RpAuthConfig,
  payload: SessionPayload,
): Promise<UserClaims | null> {
  const credentials = btoa(
    `${encodeURIComponent(config.idp.clientId)}:${encodeURIComponent(config.idp.clientSecret)}`,
  );
  let response: Response;
  try {
    response = await config.idp.fetch(`${trimTrailingSlash(config.idp.url)}${RP_SESSION_PATH}`, {
      method: "POST",
      headers: { authorization: `Basic ${credentials}`, "content-type": "application/json" },
      body: JSON.stringify({ sid: payload.sid, sub: payload.subject }),
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("IdP session check failed", err);
    throw idpUnavailable();
  }
  if (!response.ok) {
    console.error(`IdP session check returned ${response.status}`);
    throw idpUnavailable();
  }
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("IdP session check returned malformed JSON", err);
    throw idpUnavailable();
  }
  if (body.active !== true) return null;
  const claims = parseClaims(body);
  return claims.sub === payload.subject ? claims : null;
}

/** Fail closed: an unreachable IdP must not turn a revoked login into access. */
function idpUnavailable(): Response {
  return new Response("Sign-in service temporarily unavailable", {
    status: 503,
    headers: { "Retry-After": "5", "Content-Type": "text/plain; charset=utf-8" },
  });
}

function toAuthUser({ payload, claims }: VerifiedSession): AuthUser {
  return {
    id: payload.userId,
    email: claims.email ?? "",
    name: claims.name ?? claims.email ?? "",
    image: claims.picture,
    isAdmin: claims.isAdmin,
  };
}

// ─── Local display profile ─────────────────────────────────────────────────────

// Per-isolate record of the display profile last written for each user, so an
// unchanged profile costs no D1 write.
const syncedProfiles = new Map<string, string>();
const MAX_SYNCED_PROFILES = 1_000;

/**
 * The local `user` row is only an identity link plus a display cache for other
 * users' screens. Keep its name and image in step with the IdP; authorization
 * never reads it.
 */
async function syncDisplayProfile(
  db: D1Database,
  userId: string,
  claims: UserClaims,
): Promise<void> {
  const name = claims.name ?? claims.email ?? "";
  const image = claims.picture;
  const fingerprint = JSON.stringify([name, image]);
  if (syncedProfiles.get(userId) === fingerprint) return;
  try {
    await db
      .prepare(
        `UPDATE "user" SET name = ?, image = ?, updated_at = ?
         WHERE id = ? AND (name IS NOT ? OR image IS NOT ?)`,
      )
      .bind(name, image, Math.floor(Date.now() / 1000), userId, name, image)
      .run();
  } catch (err) {
    // A stale display name must never block the request.
    console.warn("local profile sync failed", err);
    return;
  }
  if (syncedProfiles.size >= MAX_SYNCED_PROFILES) syncedProfiles.clear();
  syncedProfiles.set(userId, fingerprint);
}

// ─── Access tokens ─────────────────────────────────────────────────────────────

async function fetchAccessToken(config: RpAuthConfig, session: SessionPayload): Promise<string> {
  let issuerConfig: oidc.Configuration;
  try {
    issuerConfig = await getIssuerConfig(config);
  } catch (err) {
    throw new ClaimsUnavailableError("userinfo_failed", err);
  }
  if (issuerConfig.serverMetadata().issuer !== session.issuer) {
    throw new ClaimsUnavailableError("userinfo_failed");
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
    try {
      stored = await refreshStoredTokens(config.db, issuerConfig, stored);
    } catch (err) {
      throw new ClaimsUnavailableError("refresh_failed", err);
    }
  }
  return stored.accessToken;
}

function isCurrentSession(
  session: SessionPayload | null,
  config: RpAuthConfig,
): session is SessionPayload {
  return (
    session?.version === 4 &&
    typeof session.sessionId === "string" &&
    session.sessionId.length > 0 &&
    typeof session.userId === "string" &&
    session.userId.length > 0 &&
    typeof session.issuer === "string" &&
    session.issuer === trimTrailingSlash(config.idp.url) &&
    typeof session.subject === "string" &&
    session.subject.length > 0 &&
    typeof session.sid === "string" &&
    session.sid.length > 0 &&
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

// ─── Dev sessions ──────────────────────────────────────────────────────────────

async function handleDevLogin(config: RpAuthConfig, request: Request): Promise<Response> {
  if (!isLocalAppUrl(config.appUrl)) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const as =
    (url.searchParams.get("as") ?? "dev").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "dev";
  const chapters = parseDevChapters(url.searchParams.getAll("chapter"));
  const isAdmin = url.searchParams.get("admin") === "1";

  const issuer = trimTrailingSlash(config.idp.url);
  const subject = `dev-${as}`;
  const userId = `dev-user-${as}`;
  const email = `${as}@dev.local`;
  const name = `${as} (dev)`;
  const now = Math.floor(Date.now() / 1000);

  await config.db
    .prepare(
      `INSERT INTO "user" (id, email, name, image, oidc_issuer, oidc_subject, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    )
    .bind(userId, email, name, issuer, subject, now, now)
    .run();

  const session: SessionPayload = {
    version: 4,
    sessionId: crypto.randomUUID(),
    userId,
    issuer,
    subject,
    sid: `dev-${crypto.randomUUID()}`,
    expiresAt: Date.now() + SESSION_MAX_AGE_S * 1000,
    dev: { email, name, isAdmin, chapters },
  };

  const headers = new Headers({
    Location: safeReturnTo(url.searchParams.get("return_to"), config.appUrl),
  });
  headers.append("Set-Cookie", await sessionCookie(config, session));
  return new Response(null, { status: 302, headers });
}

/** `<id>:<slug>[:organizer|member]`, repeatable; `none` for no membership. */
function parseDevChapters(values: string[]): UserChapter[] {
  if (values.length === 0) return [{ chapterId: 1, chapterSlug: "dev-chapter", role: "organizer" }];
  return values.flatMap((value) => {
    const [idRaw, slugRaw, roleRaw] = value.split(":");
    const chapterId = Number.parseInt(idRaw ?? "", 10);
    if (!Number.isInteger(chapterId) || chapterId <= 0) return [];
    const role: ChapterRole = roleRaw === "member" ? "member" : "organizer";
    return [{ chapterId, chapterSlug: slugRaw || `chapter-${chapterId}`, role }];
  });
}

function devUserClaims(payload: SessionPayload, dev: DevClaims): UserClaims {
  return {
    sub: payload.subject,
    email: dev.email,
    name: dev.name,
    picture: null,
    emailVerified: true,
    isAdmin: dev.isAdmin,
    chapter: dev.chapters[0] ?? null,
    chapters: dev.chapters,
  };
}

async function sessionCookie(config: RpAuthConfig, session: SessionPayload): Promise<string> {
  return serializeCookie({
    name: sessionCookieName(config),
    value: await signPayload(session, config.secret),
    maxAge: SESSION_MAX_AGE_S,
    secure: !isLocalAppUrl(config.appUrl),
  });
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
  const now = Math.floor(Date.now() / 1000);

  const linked = await db
    .prepare(`SELECT id FROM "user" WHERE oidc_issuer = ? AND oidc_subject = ? LIMIT 1`)
    .bind(issuer, subject)
    .first<{ id: string }>();

  if (linked) {
    await db
      .prepare(`UPDATE "user" SET name = ?, image = ?, updated_at = ? WHERE id = ?`)
      .bind(name, image, now, linked.id)
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
      // A local IdP database can be recreated independently from an RP's
      // database, changing its generated user ID (the OIDC subject) while the
      // verified account email and loopback issuer remain the same. Repair
      // only that local-development case; non-loopback issuers retain the
      // strict identity-conflict guard below.
      if (
        existingByEmail.oidc_issuer === issuer &&
        typeof existingByEmail.oidc_subject === "string" &&
        existingByEmail.oidc_subject !== subject &&
        isLoopbackIssuer(issuer)
      ) {
        const result = await db
          .prepare(
            `UPDATE "user"
             SET oidc_subject = ?, name = ?, image = ?, updated_at = ?
             WHERE id = ? AND oidc_issuer = ? AND oidc_subject = ?`,
          )
          .bind(subject, name, image, now, existingByEmail.id, issuer, existingByEmail.oidc_subject)
          .run();
        if (result.meta.changes !== 1) {
          throw new Error("OIDC identity link changed concurrently");
        }
        return existingByEmail.id;
      }
      throw new Error("Email is already linked to a different OIDC identity");
    }
    const result = await db
      .prepare(
        `UPDATE "user"
         SET oidc_issuer = ?, oidc_subject = ?, name = ?, image = ?, updated_at = ?
         WHERE id = ? AND oidc_issuer IS NULL AND oidc_subject IS NULL`,
      )
      .bind(issuer, subject, name, image, now, existingByEmail.id)
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
       (id, email, name, image, oidc_issuer, oidc_subject, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, email, name, image, issuer, subject, now, now)
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isLocalAppUrl(appUrl: string): boolean {
  try {
    const u = new URL(appUrl);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function isLoopbackIssuer(issuer: string): boolean {
  try {
    const hostname = new URL(issuer).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
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
