import * as oidc from "openid-client";

type Env = {
  IDP_ISSUER: string;
  IDP_CLIENT_ID?: string;
  IDP_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
};

type Transaction = {
  codeVerifier: string;
  exp: number;
  nonce: string;
  state: string;
};

type Session = {
  claims: Record<string, unknown>;
  exp: number;
  idToken: string;
  issuer: string;
  sub: string;
};

const SESSION_COOKIE = "gdgjp-oidc-demo-session";
const TRANSACTION_COOKIE = "gdgjp-oidc-demo-transaction";
const SESSION_MAX_AGE_S = 60 * 60 * 8;
const TRANSACTION_MAX_AGE_S = 60 * 10;
const REQUESTED_SCOPE = "openid email profile https://gdgs.jp/scopes/chapters";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const issuerCache = new Map<string, Promise<oidc.Configuration>>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/auth/login") return startLogin(request, env);
    if (url.pathname === "/auth/callback") return finishLogin(request, env);
    if (url.pathname === "/auth/logout") return logout(request, env);
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return home(request, env);
  },
} satisfies ExportedHandler<Env>;

async function home(request: Request, env: Env): Promise<Response> {
  const configured = isConfigured(env);
  const session = configured ? await readSession(request, env) : null;
  return html(
    page(
      session
        ? authenticatedContent(session)
        : configured
          ? '<p>You are not signed in.</p><p><a class="button" href="/auth/login">Log in with GDG Accounts</a></p>'
          : configurationContent(request),
    ),
  );
}

async function startLogin(request: Request, env: Env): Promise<Response> {
  if (!isConfigured(env)) return html(page(configurationContent(request)), 503);

  const issuer = await getIssuer(env);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const callback = callbackUrl(request);
  const authorizationUrl = oidc.buildAuthorizationUrl(issuer, {
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
    redirect_uri: callback,
    scope: REQUESTED_SCOPE,
    state,
  });
  const transaction: Transaction = {
    codeVerifier,
    exp: Date.now() + TRANSACTION_MAX_AGE_S * 1000,
    nonce,
    state,
  };
  return redirect(authorizationUrl.toString(), {
    "Set-Cookie": await encryptedCookie(
      TRANSACTION_COOKIE,
      transaction,
      env.SESSION_SECRET as string,
      TRANSACTION_MAX_AGE_S,
      request,
    ),
  });
}

async function finishLogin(request: Request, env: Env): Promise<Response> {
  const clearTransaction = clearCookie(TRANSACTION_COOKIE, request);
  if (!isConfigured(env))
    return loginFailure("OIDC client is not configured.", clearTransaction, 503);
  const callback = new URL(request.url);
  if (callback.searchParams.has("error")) {
    return loginFailure("GDG Accounts did not complete sign-in.", clearTransaction);
  }
  const transaction = await readEncryptedCookie<Transaction>(
    request,
    TRANSACTION_COOKIE,
    env.SESSION_SECRET as string,
  );
  if (!isTransaction(transaction)) {
    return loginFailure("The sign-in request is missing, invalid, or expired.", clearTransaction);
  }

  try {
    const issuer = await getIssuer(env);
    const tokens = await oidc.authorizationCodeGrant(issuer, callback, {
      expectedNonce: transaction.nonce,
      expectedState: transaction.state,
      idTokenExpected: true,
      pkceCodeVerifier: transaction.codeVerifier,
    });
    const idTokenClaims = tokens.claims();
    const sub = idTokenClaims?.sub;
    if (!tokens.id_token || typeof sub !== "string" || sub.length === 0) {
      return loginFailure("GDG Accounts returned an invalid identity token.", clearTransaction);
    }
    const claims = await oidc.fetchUserInfo(issuer, tokens.access_token, sub);
    const issuerName = issuer.serverMetadata().issuer;
    if (typeof issuerName !== "string" || issuerName !== env.IDP_ISSUER) {
      return loginFailure("GDG Accounts returned an unexpected issuer.", clearTransaction);
    }
    const session: Session = {
      claims: claims as Record<string, unknown>,
      exp: Date.now() + SESSION_MAX_AGE_S * 1000,
      idToken: tokens.id_token,
      issuer: issuerName,
      sub,
    };
    const headers = new Headers({ Location: new URL(request.url).origin });
    headers.append("Set-Cookie", clearTransaction);
    headers.append(
      "Set-Cookie",
      await encryptedCookie(
        SESSION_COOKIE,
        session,
        env.SESSION_SECRET as string,
        SESSION_MAX_AGE_S,
        request,
      ),
    );
    return new Response(null, { headers, status: 302 });
  } catch {
    return loginFailure("GDG Accounts could not verify this sign-in.", clearTransaction);
  }
}

async function logout(request: Request, env: Env): Promise<Response> {
  const returnTo = `${new URL(request.url).origin}/`;
  const session = isConfigured(env) ? await readSession(request, env) : null;
  let location = returnTo;
  if (session) {
    try {
      const issuer = await getIssuer(env);
      if (session.issuer === issuer.serverMetadata().issuer) {
        location = oidc
          .buildEndSessionUrl(issuer, {
            client_id: env.IDP_CLIENT_ID as string,
            id_token_hint: session.idToken,
            post_logout_redirect_uri: returnTo,
          })
          .toString();
      }
    } catch {
      // Local logout remains safe if discovery or the IdP logout endpoint is unavailable.
    }
  }
  return redirect(location, { "Set-Cookie": clearCookie(SESSION_COOKIE, request) });
}

async function getIssuer(env: Env): Promise<oidc.Configuration> {
  const key = `${env.IDP_ISSUER}|${env.IDP_CLIENT_ID}|${env.IDP_CLIENT_SECRET}`;
  let cached = issuerCache.get(key);
  if (!cached) {
    cached = oidc
      .discovery(
        new URL(env.IDP_ISSUER),
        env.IDP_CLIENT_ID as string,
        env.IDP_CLIENT_SECRET as string,
        undefined,
        {
          timeout: 10,
        },
      )
      .catch((error) => {
        issuerCache.delete(key);
        throw error;
      });
    issuerCache.set(key, cached);
  }
  return cached;
}

function isConfigured(
  env: Env,
): env is Env & Required<Pick<Env, "IDP_CLIENT_ID" | "IDP_CLIENT_SECRET" | "SESSION_SECRET">> {
  return Boolean(
    env.IDP_ISSUER && env.IDP_CLIENT_ID && env.IDP_CLIENT_SECRET && env.SESSION_SECRET,
  );
}

async function readSession(request: Request, env: Env): Promise<Session | null> {
  const session = await readEncryptedCookie<Session>(
    request,
    SESSION_COOKIE,
    env.SESSION_SECRET as string,
  );
  return isSession(session, env.IDP_ISSUER) ? session : null;
}

function isTransaction(value: Transaction | null): value is Transaction {
  return Boolean(
    value &&
      typeof value.codeVerifier === "string" &&
      typeof value.nonce === "string" &&
      typeof value.state === "string" &&
      typeof value.exp === "number" &&
      value.exp > Date.now(),
  );
}

function isSession(value: Session | null, issuer: string): value is Session {
  return Boolean(
    value &&
      typeof value.idToken === "string" &&
      typeof value.issuer === "string" &&
      value.issuer === issuer &&
      typeof value.sub === "string" &&
      typeof value.exp === "number" &&
      value.exp > Date.now() &&
      value.claims &&
      typeof value.claims === "object",
  );
}

async function encryptedCookie(
  name: string,
  payload: unknown,
  secret: string,
  maxAge: number,
  request: Request,
): Promise<string> {
  return serializeCookie(name, await encrypt(payload, secret), maxAge, request);
}

async function readEncryptedCookie<T>(
  request: Request,
  name: string,
  secret: string,
): Promise<T | null> {
  const value = readCookie(request.headers.get("Cookie"), name);
  return value ? decrypt<T>(value, secret) : null;
}

async function encrypt(payload: unknown, secret: string): Promise<string> {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return `${base64Url(iv)}.${base64Url(ciphertext)}`;
}

async function decrypt<T>(value: string, secret: string): Promise<T | null> {
  const [encodedIv, encodedCiphertext, extra] = value.split(".");
  if (!encodedIv || !encodedCiphertext || extra) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { iv: base64UrlBytes(encodedIv), name: "AES-GCM" },
      await encryptionKey(secret),
      base64UrlBytes(encodedCiphertext),
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function serializeCookie(name: string, value: string, maxAge: number, request: Request): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${isHttps(request) ? "; Secure" : ""}`;
}

function clearCookie(name: string, request: Request): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${isHttps(request) ? "; Secure" : ""}`;
}

function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/auth/callback`;
}

function redirect(location: string, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set("Location", location);
  return new Response(null, { headers: result, status: 302 });
}

function loginFailure(message: string, cookie: string, status = 400): Response {
  return html(
    page(`<p class="error">${escapeHtml(message)}</p><p><a href="/">Return home</a></p>`),
    status,
    {
      "Set-Cookie": cookie,
    },
  );
}

function configurationContent(request: Request): string {
  const origin = new URL(request.url).origin;
  return `<p class="error">This Worker is not configured with OIDC client credentials yet.</p>
<p>Register these values in GDG Accounts, then set the Worker secrets:</p>
<ul><li>Redirect URI: <code>${escapeHtml(`${origin}/auth/callback`)}</code></li>
<li>Post-logout redirect URI: <code>${escapeHtml(`${origin}/`)}</code></li></ul>`;
}

function authenticatedContent(session: Session): string {
  const claims: Record<string, unknown> = { sub: session.sub, ...session.claims };
  const picture =
    typeof claims.picture === "string" ? `<img src="${escapeHtml(claims.picture)}" alt="" />` : "";
  return `${picture}<p>You are signed in with GDG Accounts.</p><dl>${Object.entries(claims)
    .filter(([key]) => key !== "picture")
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatClaim(value))}</dd>`)
    .join("")}</dl><p><a class="button" href="/auth/logout">Log out</a></p>`;
}

function formatClaim(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'\"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] as string,
  );
}

function page(content: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GDG Accounts OIDC Client Demo</title><style>body{background:#f7f8fc;color:#172033;font:16px/1.5 system-ui,sans-serif;margin:0}main{background:#fff;border:1px solid #dde1eb;border-radius:16px;box-shadow:0 8px 32px #17203312;max-width:720px;margin:8vh auto;padding:32px}h1{margin-top:0}code,dd{overflow-wrap:anywhere}dt{color:#536079;font-weight:600;margin-top:16px}dd{margin:2px 0}.button{background:#235bd8;border-radius:8px;color:#fff;display:inline-block;padding:9px 14px;text-decoration:none}.error{color:#a32626}img{border-radius:50%;height:64px;object-fit:cover;width:64px}</style><main><h1>GDG Accounts OIDC Client Demo</h1>${content}</main></html>`;
}

function html(body: string, status = 200, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set("Content-Type", "text/html; charset=UTF-8");
  result.set("Cache-Control", "no-store");
  return new Response(body, { headers: result, status });
}
