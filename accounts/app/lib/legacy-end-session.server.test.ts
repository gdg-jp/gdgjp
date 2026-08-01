import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  handleLegacyEndSession,
  handleVerifiedEndSession,
  isMissingSessionError,
} from "./legacy-end-session.server";

function token(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${payload}.signature`;
}

function database(client: unknown) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn(async () => client) })),
    })),
  } as unknown as D1Database;
}

async function signedToken(claims: Record<string, unknown>): Promise<{
  token: string;
  jwks: { keys: JsonWebKey[] };
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = await exportJWK(publicKey);
  key.kid = "test-key";
  return {
    token: await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: key.kid })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey),
    jwks: { keys: [key] },
  };
}

describe("handleLegacyEndSession", () => {
  it("signs out Accounts and returns only to a registered app URI", async () => {
    const signOut = vi.fn(
      async () => new Response(null, { headers: { "Set-Cookie": "session=; Max-Age=0" } }),
    );
    const response = await handleLegacyEndSession(
      database({
        disabled: 0,
        enableEndSession: 1,
        postLogoutRedirectUris: '["https://url.gdgs.jp/signin"]',
      }),
      new Request(
        `https://accounts.example/api/auth/oauth2/end-session?id_token_hint=${token({ aud: "tinyurl" })}&post_logout_redirect_uri=https%3A%2F%2Furl.gdgs.jp%2Fsignin&state=return-state`,
      ),
      signOut,
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("https://url.gdgs.jp/signin?state=return-state");
    expect(response?.headers.get("Set-Cookie")).toContain("session=");
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("leaves current tokens and unregistered redirects to Better Auth", async () => {
    const signOut = vi.fn();
    const registered = database({
      disabled: 0,
      enableEndSession: 1,
      postLogoutRedirectUris: '["https://url.gdgs.jp/signin"]',
    });
    const current = await handleLegacyEndSession(
      registered,
      new Request(
        `https://accounts.example/api/auth/oauth2/end-session?id_token_hint=${token({ aud: "tinyurl", sid: "session-id" })}&post_logout_redirect_uri=https%3A%2F%2Furl.gdgs.jp%2Fsignin`,
      ),
      signOut,
    );
    const unregistered = await handleLegacyEndSession(
      registered,
      new Request(
        `https://accounts.example/api/auth/oauth2/end-session?id_token_hint=${token({ aud: "tinyurl" })}&post_logout_redirect_uri=https%3A%2F%2Fevil.example`,
      ),
      signOut,
    );

    expect(current).toBeNull();
    expect(unregistered).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("only enables the fallback after Better Auth verified the legacy-token error", async () => {
    expect(
      await isMissingSessionError(
        Response.json({ message: "id token missing session" }, { status: 500 }),
      ),
    ).toBe(true);
    expect(
      await isMissingSessionError(Response.json({ message: "invalid issuer" }, { status: 500 })),
    ).toBe(false);
  });

  it("recognizes the same verified diagnostic when middleware changes its JSON shape", async () => {
    expect(
      await isMissingSessionError(
        Response.json(
          { error: "invalid_request", error_description: "id token missing session" },
          { status: 500 },
        ),
      ),
    ).toBe(true);
    expect(
      await isMissingSessionError(new Response("id token missing session", { status: 500 })),
    ).toBe(true);
  });

  it("recovers a JWKS-fetch provider failure with a locally verified ID token", async () => {
    const { token: idToken, jwks } = await signedToken({
      aud: "tinyurl",
      iss: "https://accounts.example",
      sub: "user-1",
      sid: "session-1",
    });
    const signOut = vi.fn(
      async () => new Response(null, { headers: { "Set-Cookie": "session=; Max-Age=0" } }),
    );

    const response = await handleVerifiedEndSession(
      database({
        disabled: 0,
        enableEndSession: 1,
        postLogoutRedirectUris: '["https://url.gdgs.jp/signin"]',
      }),
      new Request(
        `https://accounts.example/api/auth/oauth2/end-session?id_token_hint=${idToken}&post_logout_redirect_uri=https%3A%2F%2Furl.gdgs.jp%2Fsignin`,
      ),
      "https://accounts.example",
      { getJwks: async () => jwks },
      signOut,
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("https://url.gdgs.jp/signin");
    expect(signOut).toHaveBeenCalledOnce();
  });
});
