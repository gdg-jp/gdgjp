import { describe, expect, it, vi } from "vitest";
import { handleLegacyEndSession, isMissingSessionError } from "./legacy-end-session.server";

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
});
