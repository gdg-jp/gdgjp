const API_BASE = "https://api.luma.com";
const SESSION_COOKIE = "luma.auth-session-key";
const SESSION_KEY = "luma:bot:sessionKey";

export class LumaApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`luma_api_${status}: ${path}`);
  }
}

export function lumaBotCredentials(env: Env): { email: string; password: string } {
  const email = env.LUMA_BOT_EMAIL?.trim();
  const password = env.LUMA_BOT_PASSWORD?.trim();
  if (!email || !password) throw new Error("luma_bot_credentials_missing");
  return { email, password };
}

function sessionKeyFromSetCookie(headers: Headers): string | null {
  for (const cookie of headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const eq = pair?.indexOf("=") ?? -1;
    if (pair && eq > 0 && pair.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = pair.slice(eq + 1).trim();
      if (value) return decodeURIComponent(value);
    }
  }
  return null;
}

/**
 * Password sign-in as the shared bot account. Luma answers 200 without a session
 * when it wants a second factor (`step: "two_factor"`), which the bot cannot
 * complete, so that is reported as a distinct failure.
 */
export async function signInToLuma(env: Env): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/sign-in-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lumaBotCredentials(env)),
  });
  const text = await response.text();
  if (!response.ok) throw new LumaApiError("/auth/sign-in-with-password", response.status, text);
  const body = JSON.parse(text) as { signed_in?: boolean; step?: string; auth_token?: string };
  if (body.signed_in === false || body.step === "two_factor") {
    throw new Error(`luma_login_needs_${body.step ?? "verification"}`);
  }
  const sessionKey = sessionKeyFromSetCookie(response.headers) ?? body.auth_token ?? null;
  if (!sessionKey) throw new Error("luma_login_no_session");
  await env.SESSION_KV.put(SESSION_KEY, sessionKey);
  return sessionKey;
}

async function request<T>(
  sessionKey: string,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(path, API_BASE);
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionKey)}`,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(params) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new LumaApiError(path, response.status, text);
  return JSON.parse(text) as T;
}

export type LumaClient = {
  get<T>(path: string, params: Record<string, string>): Promise<T>;
  post<T>(path: string, body: Record<string, string>): Promise<T>;
};

export function lumaClient(env: Env): LumaClient {
  let sessionKey: Promise<string> | null = null;
  const current = () => {
    sessionKey ??= env.SESSION_KV.get(SESSION_KEY).then((key) => key ?? signInToLuma(env));
    return sessionKey;
  };
  const call = async <T>(method: "GET" | "POST", path: string, params: Record<string, string>) => {
    const key = await current();
    try {
      return await request<T>(key, method, path, params);
    } catch (error) {
      if (!(error instanceof LumaApiError) || error.status !== 401) throw error;
      sessionKey = signInToLuma(env);
      return request<T>(await sessionKey, method, path, params);
    }
  };
  return {
    get: (path, params) => call("GET", path, params),
    post: (path, body) => call("POST", path, body),
  };
}
