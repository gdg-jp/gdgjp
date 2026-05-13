import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { genericOAuth, oidcProvider } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import {
  type AuthUser,
  SSO_PROVIDER_ID,
  type SessionApi,
  type UserChapter,
  type UserClaims,
  getSessionUser as getSessionUserFromApi,
  requireUser as requireUserFromApi,
} from "./index";

// ─── RP factory ────────────────────────────────────────────────────────────────

export interface AuthConfig {
  db: D1Database;
  appUrl: string;
  cookiePrefix: string;
  secret: string;
  idp: { url: string; clientId: string; clientSecret: string };
}

export interface AuthInstance {
  getSessionUser(request: Request): Promise<AuthUser | null>;
  requireUser(request: Request): Promise<AuthUser>;
  signOut(request: Request): Promise<Response>;
  handleAuthRequest(request: Request): Promise<Response>;
  handleSignOutRedirect(request: Request, options?: { returnTo?: string }): Promise<Response>;
  /**
   * RP-side handler for the IdP's top-level redirect chain. Verifies the iss
   * and continue URL origins both match the IdP, clears the local session
   * cookie, then redirects to the continue URL. Replaces the iframe-based
   * handleSignOutIframe — same logical role, top-level navigation instead of
   * a third-party-cookie-dependent iframe.
   */
  handleFrontchannelLogout(request: Request): Promise<Response>;
  /**
   * Fetch the user's current claims from the IdP /oauth2/userinfo endpoint,
   * refreshing the stored access_token via refresh_token grant if needed.
   * Throws ClaimsUnavailableError if the IdP cannot be queried for this user
   * (no linked account, refresh token expired/revoked, IdP unreachable).
   * Callers should catch and redirect to /signin to force re-auth.
   */
  getFreshClaims(userId: string): Promise<UserClaims>;
}

export function initializeAuth(config: AuthConfig): AuthInstance {
  const auth = buildRpAuth(config);
  const sessionApi = auth as unknown as SessionApi;

  return {
    getSessionUser: (request) => getSessionUserFromApi(sessionApi, request),
    requireUser: (request) => requireUserFromApi(sessionApi, request),
    signOut: (request) =>
      auth.api.signOut({ headers: request.headers, asResponse: true }) as Promise<Response>,
    handleAuthRequest: (request) => auth.handler(request),
    handleSignOutRedirect: async (request, options) => {
      const returnTo = options?.returnTo ?? `${config.appUrl}/signin`;
      const idTokenHint = await fetchIdTokenHint(config, sessionApi, request);
      const params = new URLSearchParams();
      params.set("return_to", returnTo);
      params.set("client_id", config.idp.clientId);
      if (idTokenHint) params.set("id_token_hint", idTokenHint);
      const location = `${config.idp.url}/auth/signout?${params.toString()}`;
      return new Response(null, { status: 302, headers: { Location: location } });
    },
    getFreshClaims: (userId) => fetchUserClaims(config, userId),
    handleFrontchannelLogout: async (request) => {
      const url = new URL(request.url);
      const iss = url.searchParams.get("iss");
      const cont = url.searchParams.get("continue");
      const expectedIdpOrigin = safeOrigin(config.idp.url);
      if (!expectedIdpOrigin || !iss || safeOrigin(iss) !== expectedIdpOrigin) {
        console.error("auth.frontchannel-logout: iss origin does not match IdP", {
          iss,
          expected: expectedIdpOrigin,
        });
        return new Response("invalid_request: iss", { status: 400 });
      }
      if (!cont || safeOrigin(cont) !== expectedIdpOrigin) {
        console.error("auth.frontchannel-logout: continue origin does not match IdP", {
          continue: cont,
          expected: expectedIdpOrigin,
        });
        return new Response("invalid_request: continue", { status: 400 });
      }
      let cookies: string[] = [];
      try {
        const res = (await auth.api.signOut({
          headers: request.headers,
          asResponse: true,
        })) as Response;
        cookies = collectSetCookies(res.headers);
      } catch (err) {
        console.error("auth.frontchannel-logout: signOut failed", { url: request.url, err });
        // Still redirect — best-effort. Browser-side cookie may persist until expiry.
      }
      const headers = new Headers({
        Location: cont,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      for (const c of cookies) headers.append("set-cookie", c);
      return new Response(null, { status: 302, headers });
    },
  };
}

function safeOrigin(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

function buildRpAuth(config: AuthConfig) {
  const db = new Kysely<Record<string, unknown>>({
    dialect: new D1Dialect({ database: config.db }),
  });
  return betterAuth({
    baseURL: config.appUrl,
    secret: config.secret,
    database: { db, type: "sqlite" },
    advanced: { cookiePrefix: config.cookiePrefix },
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: SSO_PROVIDER_ID,
            clientId: config.idp.clientId,
            clientSecret: config.idp.clientSecret,
            discoveryUrl: `${config.idp.url}/api/auth/.well-known/openid-configuration`,
            scopes: ["openid", "email", "profile", "offline_access", "gdgjp:chapters"],
            pkce: true,
            mapProfileToUser: (profile) => ({
              email: profile.email,
              name: profile.name ?? profile.email,
              image: profile.picture ?? null,
              emailVerified: profile.email_verified === true,
            }),
          },
        ],
      }),
    ],
  });
}

// ─── Live claims via /oauth2/userinfo ──────────────────────────────────────────

export class ClaimsUnavailableError extends Error {
  constructor(
    public readonly reason: "no_linked_account" | "refresh_failed" | "userinfo_failed",
    cause?: unknown,
  ) {
    super(`claims unavailable: ${reason}`);
    this.name = "ClaimsUnavailableError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

interface AccountTokenRow {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
}

const REFRESH_LEEWAY_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const CLAIMS_CACHE_TTL_MS = 5 * 60 * 1000;
const inflightClaims = new Map<string, Promise<UserClaims>>();

async function fetchIdTokenHint(
  config: AuthConfig,
  sessionApi: SessionApi,
  request: Request,
): Promise<string | null> {
  const user = await getSessionUserFromApi(sessionApi, request);
  if (!user) return null;
  const row = await config.db
    .prepare("SELECT idToken FROM account WHERE userId = ? AND providerId = ? LIMIT 1")
    .bind(user.id, SSO_PROVIDER_ID)
    .first<{ idToken: string | null }>();
  return row?.idToken ?? null;
}

async function fetchUserClaims(config: AuthConfig, userId: string): Promise<UserClaims> {
  const inflight = inflightClaims.get(userId);
  if (inflight) return inflight;

  const promise = (async () => {
    const cached = await readCachedClaims(config, userId);
    if (cached) return cached;

    const row = await config.db
      .prepare(
        `SELECT id, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt
         FROM account WHERE userId = ? AND providerId = ? LIMIT 1`,
      )
      .bind(userId, SSO_PROVIDER_ID)
      .first<AccountTokenRow>();
    if (!row) throw new ClaimsUnavailableError("no_linked_account");

    let accessToken = row.accessToken;
    const accessExp = row.accessTokenExpiresAt ? Date.parse(row.accessTokenExpiresAt) : 0;
    if (!accessToken || Number.isNaN(accessExp) || accessExp - REFRESH_LEEWAY_MS < Date.now()) {
      accessToken = await refreshAccessToken(config, row);
    }

    const res = await fetchUserInfo(config.idp.url, accessToken);
    let json: Record<string, unknown>;
    if (res.status === 401) {
      const refreshed = await refreshAccessToken(config, row);
      const retry = await fetchUserInfo(config.idp.url, refreshed);
      if (!retry.ok) throw new ClaimsUnavailableError("userinfo_failed");
      json = (await retry.json()) as Record<string, unknown>;
    } else if (!res.ok) {
      throw new ClaimsUnavailableError("userinfo_failed");
    } else {
      json = (await res.json()) as Record<string, unknown>;
    }
    const claims = parseClaims(json);
    await writeCachedClaims(config, userId, json);
    return claims;
  })().finally(() => inflightClaims.delete(userId));

  inflightClaims.set(userId, promise);
  return promise;
}

async function readCachedClaims(config: AuthConfig, userId: string): Promise<UserClaims | null> {
  const row = await config.db
    .prepare("SELECT claims_json, fetched_at FROM userinfo_cache WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ claims_json: string; fetched_at: number }>();
  if (!row) return null;
  if (Date.now() - row.fetched_at > CLAIMS_CACHE_TTL_MS) return null;
  try {
    return parseClaims(JSON.parse(row.claims_json) as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function writeCachedClaims(
  config: AuthConfig,
  userId: string,
  json: Record<string, unknown>,
): Promise<void> {
  try {
    await config.db
      .prepare(
        `INSERT INTO userinfo_cache (user_id, claims_json, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET claims_json = excluded.claims_json, fetched_at = excluded.fetched_at`,
      )
      .bind(userId, JSON.stringify(json), Date.now())
      .run();
  } catch (err) {
    // Cache write failure shouldn't break the request — log and continue.
    console.warn("auth.userinfo_cache: write failed", { userId, err });
  }
}

async function fetchUserInfo(idpUrl: string, accessToken: string): Promise<Response> {
  try {
    return await fetch(`${idpUrl}/api/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ClaimsUnavailableError("userinfo_failed", err);
  }
}

async function refreshAccessToken(config: AuthConfig, row: AccountTokenRow): Promise<string> {
  if (!row.refreshToken) throw new ClaimsUnavailableError("refresh_failed");
  const refreshExp = row.refreshTokenExpiresAt ? Date.parse(row.refreshTokenExpiresAt) : 0;
  if (!Number.isNaN(refreshExp) && refreshExp > 0 && refreshExp <= Date.now()) {
    throw new ClaimsUnavailableError("refresh_failed");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
    client_id: config.idp.clientId,
    client_secret: config.idp.clientSecret,
  });
  let res: Response;
  try {
    res = await fetch(`${config.idp.url}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ClaimsUnavailableError("refresh_failed", err);
  }
  if (!res.ok) throw new ClaimsUnavailableError("refresh_failed");
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new ClaimsUnavailableError("refresh_failed");
  const accessExpiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await config.db
    .prepare(
      `UPDATE account
       SET accessToken = ?, refreshToken = COALESCE(?, refreshToken),
           accessTokenExpiresAt = ?, updatedAt = ?
       WHERE id = ?`,
    )
    .bind(
      data.access_token,
      data.refresh_token ?? null,
      accessExpiresAt,
      new Date().toISOString(),
      row.id,
    )
    .run();
  row.accessToken = data.access_token;
  row.refreshToken = data.refresh_token ?? row.refreshToken;
  row.accessTokenExpiresAt = accessExpiresAt;
  return data.access_token;
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
    sub: typeof json.sub === "string" && json.sub.length ? json.sub : "userinfo_failed",
    email: typeof json.email === "string" ? json.email : null,
    name: typeof json.name === "string" ? json.name : null,
    picture: typeof json.picture === "string" ? json.picture : null,
    emailVerified: json.email_verified === true,
    isAdmin: json.isAdmin === true,
    chapter,
    chapters,
  };
}

// ─── IdP factory ───────────────────────────────────────────────────────────────

export interface IdpClient {
  clientId: string;
  clientSecret: string;
  type: "web" | "public" | "native" | "user-agent-based";
  name: string;
  redirectUrls: string[];
  metadata: Record<string, unknown> | null;
  disabled: boolean;
  skipConsent: boolean;
}

export interface IdpAuthConfig {
  db: D1Database;
  appUrl: string;
  cookiePrefix: string;
  secret: string;
  loginPage?: string;
  google?: {
    clientId: string;
    clientSecret: string;
    prompt?: "none" | "select_account" | "consent" | "login" | "select_account consent";
  };
  trustedClients: IdpClient[];
  /** Custom OAuth scope names to merge with the OIDC defaults. */
  scopes?: string[];
  getAdditionalUserInfoClaim?: (
    user: { id: string; isAdmin?: boolean | null },
    scopes: string[],
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface IdpAuthInstance {
  getSessionUser(request: Request): Promise<AuthUser | null>;
  requireUser(request: Request): Promise<AuthUser>;
  handleAuthRequest(request: Request): Promise<Response>;
  /**
   * Federated logout entry. Mints a signed state JWT carrying the chain of
   * RPs to visit + final return_to, then 302 redirects the user-agent to the
   * first RP's frontchannel-logout URL. Each RP clears its own cookie in a
   * top-level navigation context (no third-party cookie reliance) and
   * redirects back to handleAdvanceSignOut, which forwards to the next step.
   */
  handleFederatedSignOut(
    request: Request,
    options: {
      rpOrigins: string[];
      frontchannelPath?: string;
      advancePath?: string;
      fallbackReturnTo?: string;
    },
  ): Promise<Response>;
  /**
   * Chain step handler: verifies state JWT, advances to next RP, or — when
   * all RPs are done — clears the IdP session and 302s to final return_to.
   */
  handleAdvanceSignOut(
    request: Request,
    options?: {
      frontchannelPath?: string;
      advancePath?: string;
      fallbackReturnTo?: string;
    },
  ): Promise<Response>;
}

export function initializeIdpAuth(config: IdpAuthConfig): IdpAuthInstance {
  const auth = buildIdpAuth(config);
  const sessionApi = auth as unknown as SessionApi;

  return {
    getSessionUser: (request) => getSessionUserFromApi(sessionApi, request),
    requireUser: (request) => requireUserFromApi(sessionApi, request),
    handleAuthRequest: (request) => auth.handler(request),
    handleFederatedSignOut: async (request, options) => {
      const frontchannelPath = options.frontchannelPath ?? "/auth/frontchannel-logout";
      const advancePath = options.advancePath ?? "/auth/signout/advance";
      const fallbackReturnTo = options.fallbackReturnTo ?? "/signin";

      const url = new URL(request.url);
      const target = safeReturnTo(
        url.searchParams.get("return_to") ?? fallbackReturnTo,
        config.appUrl,
        options.rpOrigins,
        fallbackReturnTo,
      );

      const dedupedOrigins = [...new Set(options.rpOrigins)];

      // No RPs registered — just clear the IdP session and land at return_to.
      if (dedupedOrigins.length === 0) {
        return finalizeIdpSignOut(auth, request, target);
      }

      const stateJwt = await signLogoutState(
        {
          step: 0,
          rps: dedupedOrigins,
          returnTo: target,
          frontchannelPath,
        },
        config.secret,
      );

      const idpOrigin = new URL(config.appUrl).origin;
      const continueUrl = `${idpOrigin}${advancePath}?state=${encodeURIComponent(stateJwt)}`;
      const next = `${dedupedOrigins[0]}${frontchannelPath}?iss=${encodeURIComponent(idpOrigin)}&continue=${encodeURIComponent(continueUrl)}`;
      return new Response(null, {
        status: 302,
        headers: { Location: next, "Cache-Control": "no-store" },
      });
    },
    handleAdvanceSignOut: async (request, options) => {
      const frontchannelPath = options?.frontchannelPath ?? "/auth/frontchannel-logout";
      const advancePath = options?.advancePath ?? "/auth/signout/advance";
      const fallbackReturnTo = options?.fallbackReturnTo ?? "/signin";
      const fallbackUrl = new URL(fallbackReturnTo, config.appUrl).toString();

      const url = new URL(request.url);
      const stateParam = url.searchParams.get("state");
      if (!stateParam) {
        console.error("auth.signout.advance: missing state");
        return new Response(null, {
          status: 302,
          headers: { Location: fallbackUrl },
        });
      }

      let state: LogoutState | null;
      try {
        state = await verifyLogoutState(stateParam, config.secret);
      } catch (err) {
        console.error("auth.signout.advance: state verification failed", { err });
        return new Response(null, {
          status: 302,
          headers: { Location: fallbackUrl },
        });
      }
      if (!state) {
        return new Response(null, {
          status: 302,
          headers: { Location: fallbackUrl },
        });
      }

      const nextStep = state.step + 1;
      if (nextStep >= state.rps.length) {
        return finalizeIdpSignOut(auth, request, state.returnTo);
      }

      const idpOrigin = new URL(config.appUrl).origin;
      const nextState = await signLogoutState({ ...state, step: nextStep }, config.secret);
      const continueUrl = `${idpOrigin}${advancePath}?state=${encodeURIComponent(nextState)}`;
      const nextRpOrigin = state.rps[nextStep];
      const next = `${nextRpOrigin}${frontchannelPath}?iss=${encodeURIComponent(idpOrigin)}&continue=${encodeURIComponent(continueUrl)}`;
      return new Response(null, {
        status: 302,
        headers: { Location: next, "Cache-Control": "no-store" },
      });
    },
  };
}

async function finalizeIdpSignOut(
  auth: { api: { signOut: (args: { headers: Headers; asResponse: true }) => Promise<unknown> } },
  request: Request,
  returnTo: string,
): Promise<Response> {
  let cookies: string[] = [];
  try {
    const res = (await auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    })) as Response;
    cookies = collectSetCookies(res.headers);
  } catch (err) {
    console.error("auth.signout.finalize: signOut failed at IdP", { err });
  }
  const headers = new Headers({
    Location: returnTo,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

interface LogoutState {
  step: number;
  rps: string[];
  returnTo: string;
  frontchannelPath: string;
}

const LOGOUT_STATE_TTL_SECONDS = 5 * 60;

async function signLogoutState(state: LogoutState, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...state, iat: now, exp: now + LOGOUT_STATE_TTL_SECONDS };
  const headerB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput) as BufferSource,
  );
  return `${signingInput}.${b64uEncode(new Uint8Array(sig))}`;
}

async function verifyLogoutState(token: string, secret: string): Promise<LogoutState | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64uDecode(headerB64)));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64uDecode(sigB64) as BufferSource,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`) as BufferSource,
  );
  if (!ok) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uDecode(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return null;
  if (
    typeof payload.step !== "number" ||
    !Array.isArray(payload.rps) ||
    typeof payload.returnTo !== "string" ||
    typeof payload.frontchannelPath !== "string"
  ) {
    return null;
  }
  return {
    step: payload.step,
    rps: payload.rps as string[],
    returnTo: payload.returnTo,
    frontchannelPath: payload.frontchannelPath,
  };
}

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64uDecode(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildIdpAuth(config: IdpAuthConfig) {
  const db = new Kysely<Record<string, unknown>>({
    dialect: new D1Dialect({ database: config.db }),
  });
  return betterAuth({
    baseURL: config.appUrl,
    secret: config.secret,
    database: { db, type: "sqlite" },
    advanced: { cookiePrefix: config.cookiePrefix },
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      additionalFields: {
        isAdmin: { type: "boolean", required: false, input: false },
      },
    },
    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            prompt: config.google.prompt ?? "select_account",
          },
        }
      : undefined,
    plugins: [
      oidcProvider({
        loginPage: config.loginPage ?? "/signin",
        requirePKCE: true,
        // Defense-in-depth: any dynamically registered client's secret is
        // SHA-256 hashed at rest. Today our trustedClients come in from env
        // and are kept in memory by better-auth, so this only matters if we
        // ever wire up /oauth2/register. See docs/01_sso_migration/M4.md.
        storeClientSecret: "hashed",
        trustedClients: config.trustedClients,
        scopes: config.scopes,
        getAdditionalUserInfoClaim: config.getAdditionalUserInfoClaim
          ? async (user, scopes) => {
              const fn = config.getAdditionalUserInfoClaim;
              if (!fn) return {};
              return fn(user as { id: string; isAdmin?: boolean | null }, scopes);
            }
          : undefined,
      }),
    ],
  });
}

// ─── shared helpers ────────────────────────────────────────────────────────────

function collectSetCookies(headers: Headers): string[] {
  const fn = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof fn === "function") return fn.call(headers);
  const out: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") out.push(value);
  });
  return out;
}

function safeReturnTo(
  returnTo: string,
  appUrl: string,
  rpOrigins: string[],
  fallbackPath: string,
): string {
  try {
    const url = new URL(returnTo, appUrl);
    const selfOrigin = new URL(appUrl).origin;
    if (url.origin === selfOrigin || rpOrigins.includes(url.origin)) return url.toString();
  } catch {}
  return new URL(fallbackPath, appUrl).toString();
}
