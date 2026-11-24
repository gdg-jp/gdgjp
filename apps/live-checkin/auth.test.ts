import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const app = "http://localhost:3000";
const issuer = "https://accounts.test";
const clientId = "live-checkin";
const clientSecret = "live-checkin-secret";
const accessToken = "accounts-access-token";
const chapters = [{ chapterId: 7, chapterSlug: "gdg-kwansai", role: "organizer" }];
const gdgClaims = {
  "https://gdgs.jp/claims/chapters": chapters,
  "https://gdgs.jp/claims/is_admin": false,
};

function base64url(value: string | ArrayBuffer) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

async function signIdToken(payload: Record<string, unknown>) {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const input = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(signature)}`;
}

async function accounts(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== issuer) throw new Error(`unexpected request to ${request.url}`);
  switch (url.pathname) {
    case "/.well-known/openid-configuration":
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/api/auth/oauth2/authorize`,
        token_endpoint: `${issuer}/api/auth/oauth2/token`,
        userinfo_endpoint: `${issuer}/api/auth/oauth2/userinfo`,
        jwks_uri: `${issuer}/api/auth/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    case "/api/auth/oauth2/token": {
      const form = new URLSearchParams(await request.text());
      if (form.get("code") !== "authorization-code") {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      return Response.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid profile email https://gdgs.jp/scopes/chapters",
        id_token: await signIdToken({
          iss: issuer,
          sub: "user-1",
          aud: clientId,
          iat: now,
          exp: now + 600,
          auth_time: now,
          acr: "0",
          ...gdgClaims,
        }),
      });
    }
    case "/api/auth/oauth2/userinfo":
      if (request.headers.get("authorization") !== `Bearer ${accessToken}`) {
        return Response.json({ error: "invalid_token" }, { status: 401 });
      }
      return Response.json({
        sub: "user-1",
        name: "Kwansai Organizer",
        picture: "https://accounts.test/avatar.png",
        email: "organizer@kwansai.test",
        email_verified: true,
        ...gdgClaims,
      });
    default:
      return new Response("not found", { status: 404 });
  }
}

const jar = new Map<string, string>();

function remember(response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return response;
}

function request(
  path: string,
  init: { method?: string; body?: string; headers?: HeadersInit } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
  return new NextRequest(new URL(path, app), { ...init, headers });
}

beforeAll(() => {
  vi.stubEnv("AUTH_SECRET", "live-checkin-test-secret-0123456789abcdef");
  vi.stubEnv("AUTH_URL", app);
  vi.stubEnv("ACCOUNTS_URL", issuer);
  vi.stubEnv("GDG_CLIENT_ID", clientId);
  vi.stubEnv("GDG_CLIENT_SECRET", clientSecret);
  vi.stubGlobal("fetch", vi.fn(accounts));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GDG Accounts sign-in", () => {
  it("puts the Accounts user's name and email into the session with the chapter claims", async () => {
    const { handlers } = await import("./auth");

    const csrf = remember(await handlers.GET(request("/api/auth/csrf")));
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };

    const signIn = remember(
      await handlers.POST(
        request("/api/auth/signin/gdg-accounts", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ csrfToken, callbackUrl: `${app}/checkin` }).toString(),
        }),
      ),
    );
    const authorize = new URL(signIn.headers.get("location") ?? "");
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${issuer}/api/auth/oauth2/authorize`);
    expect(authorize.searchParams.get("scope")).toBe(
      "openid profile email https://gdgs.jp/scopes/chapters",
    );

    const callback = remember(
      await handlers.GET(
        request(
          `/api/auth/callback/gdg-accounts?${new URLSearchParams({
            code: "authorization-code",
            state: authorize.searchParams.get("state") ?? "",
          })}`,
        ),
      ),
    );
    expect(callback.headers.get("location")).toBe(`${app}/checkin`);

    const session = await (await handlers.GET(request("/api/auth/session"))).json();
    expect(session).toMatchObject({
      accessToken,
      user: {
        name: "Kwansai Organizer",
        email: "organizer@kwansai.test",
        image: "https://accounts.test/avatar.png",
        chapters,
        isAdmin: false,
      },
    });
  });
});
