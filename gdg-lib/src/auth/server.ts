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
  handleSignOutRedirect(request: Request, options?: { returnTo?: string }): Response;
  handleSignOutIframe(request: Request): Promise<Response>;
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
    handleSignOutRedirect: (_request, options) => {
      const returnTo = options?.returnTo ?? `${config.appUrl}/signin`;
      const location = `${config.idp.url}/auth/signout?return_to=${encodeURIComponent(returnTo)}`;
      return new Response(null, { status: 302, headers: { Location: location } });
    },
    getFreshClaims: (userId) => fetchUserClaims(config, userId),
    handleSignOutIframe: async (request) => {
      const csp = frameAncestorsCsp(config.idp.url, request.url);
      let cookies: string[];
      try {
        const res = (await auth.api.signOut({
          headers: request.headers,
          asResponse: true,
        })) as Response;
        cookies = collectSetCookies(res.headers);
      } catch (err) {
        console.error("auth.signout-iframe: signOut failed", { url: request.url, err });
        return new Response("sign-out failed", {
          status: 500,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": csp,
            "Referrer-Policy": "no-referrer",
          },
        });
      }
      const headers = new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": csp,
        "Referrer-Policy": "no-referrer",
      });
      for (const c of cookies) headers.append("set-cookie", c);
      return new Response("<!doctype html><meta charset=utf-8><title>ok</title>", {
        status: 200,
        headers,
      });
    },
  };
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
    user: {
      additionalFields: {
        isAdmin: { type: "boolean", required: false, input: false },
      },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: SSO_PROVIDER_ID,
            clientId: config.idp.clientId,
            clientSecret: config.idp.clientSecret,
            discoveryUrl: `${config.idp.url}/api/auth/.well-known/openid-configuration`,
            scopes: ["openid", "email", "profile", "offline_access"],
            pkce: true,
            mapProfileToUser: (profile) => ({
              email: profile.email,
              name: profile.name ?? profile.email,
              image: profile.picture ?? null,
              emailVerified: profile.email_verified === true,
              isAdmin: profile.isAdmin === true,
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
const inflightClaims = new Map<string, Promise<UserClaims>>();

async function fetchUserClaims(config: AuthConfig, userId: string): Promise<UserClaims> {
  const inflight = inflightClaims.get(userId);
  if (inflight) return inflight;

  const promise = (async () => {
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
    if (res.status === 401) {
      const refreshed = await refreshAccessToken(config, row);
      const retry = await fetchUserInfo(config.idp.url, refreshed);
      if (!retry.ok) throw new ClaimsUnavailableError("userinfo_failed");
      return parseClaims((await retry.json()) as Record<string, unknown>);
    }
    if (!res.ok) throw new ClaimsUnavailableError("userinfo_failed");
    return parseClaims((await res.json()) as Record<string, unknown>);
  })().finally(() => inflightClaims.delete(userId));

  inflightClaims.set(userId, promise);
  return promise;
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
  getAdditionalUserInfoClaim?: (
    user: { id: string },
    scopes: string[],
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface IdpAuthInstance {
  getSessionUser(request: Request): Promise<AuthUser | null>;
  requireUser(request: Request): Promise<AuthUser>;
  handleAuthRequest(request: Request): Promise<Response>;
  handleFederatedSignOut(
    request: Request,
    options: {
      rpOrigins: string[];
      iframePath?: string;
      fallbackReturnTo?: string;
      timeoutMs?: number;
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
      const iframePath = options.iframePath ?? "/auth/signout-iframe";
      const fallbackReturnTo = options.fallbackReturnTo ?? "/signin";
      const timeoutMs = options.timeoutMs ?? 3000;

      const url = new URL(request.url);
      const target = safeReturnTo(
        url.searchParams.get("return_to") ?? fallbackReturnTo,
        config.appUrl,
        options.rpOrigins,
        fallbackReturnTo,
      );

      let cookies: string[] = [];
      try {
        const res = (await auth.api.signOut({
          headers: request.headers,
          asResponse: true,
        })) as Response;
        cookies = collectSetCookies(res.headers);
      } catch (err) {
        console.error("auth.signout: auth.api.signOut failed at IdP", {
          url: request.url,
          err,
        });
      }

      const iframeUrls = options.rpOrigins.map((origin) => `${origin}${iframePath}`);
      const headers = new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      for (const c of cookies) headers.append("set-cookie", c);
      return new Response(renderFederatedSignOutPage(iframeUrls, target, timeoutMs), {
        status: 200,
        headers,
      });
    },
  };
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
        storeClientSecret: "plain",
        trustedClients: config.trustedClients,
        getAdditionalUserInfoClaim: config.getAdditionalUserInfoClaim
          ? async (user, scopes) => {
              const fn = config.getAdditionalUserInfoClaim;
              if (!fn) return {};
              return fn(user, scopes);
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

function frameAncestorsCsp(idpUrl: string | undefined, requestUrl: string): string {
  if (!idpUrl) {
    console.warn("auth.signout-iframe: IDP_URL is not set; emitting CSP without external origin", {
      url: requestUrl,
    });
    return "frame-ancestors 'self'";
  }
  try {
    return `frame-ancestors 'self' ${new URL(idpUrl).origin}`;
  } catch {
    console.warn(
      "auth.signout-iframe: IDP_URL is not a valid URL; emitting CSP without external origin",
      { url: requestUrl, idpUrl },
    );
    return "frame-ancestors 'self'";
  }
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

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function renderFederatedSignOutPage(
  iframeUrls: string[],
  target: string,
  timeoutMs: number,
): string {
  const iframes = iframeUrls
    .map(
      (u) =>
        `<iframe src="${escapeHtml(u)}" referrerpolicy="no-referrer" style="display:none" aria-hidden="true"></iframe>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signing out…</title>
<meta name="robots" content="noindex" />
</head>
<body>
<p>Signing out…</p>
${iframes}
<script>
(function () {
  var done = false;
  var target = ${JSON.stringify(target)};
  var total = ${iframeUrls.length};
  var loaded = 0;
  function go() { if (done) return; done = true; window.location.replace(target); }
  if (total === 0) { go(); return; }
  document.querySelectorAll('iframe').forEach(function (f) {
    var settle = function () { loaded += 1; if (loaded >= total) go(); };
    f.addEventListener('load', settle, { once: true });
    f.addEventListener('error', settle, { once: true });
  });
  setTimeout(go, ${timeoutMs});
})();
</script>
</body>
</html>`;
}
