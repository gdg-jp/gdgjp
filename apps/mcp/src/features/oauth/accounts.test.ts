import {
  UpstreamGrantError,
  UpstreamUnavailableError,
  accessTokenTtl,
  refreshTokens,
  upstreamAuthorizeUrl,
} from "./accounts";

const env = {
  APP_URL: "https://mcp.gdgs.jp/",
  ACCOUNTS_URL: "https://accounts.gdgs.jp",
  IDP_CLIENT_ID: "mcp",
  IDP_CLIENT_SECRET: "secret",
};

describe("upstreamAuthorizeUrl", () => {
  it("asks Accounts for the chapter claims with PKCE and the seeded redirect URI", () => {
    const url = new URL(upstreamAuthorizeUrl(env, { state: "st", codeChallenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://accounts.gdgs.jp/api/auth/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "mcp",
      redirect_uri: "https://mcp.gdgs.jp/callback",
      scope: "openid email profile offline_access https://gdgs.jp/scopes/chapters",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});

describe("refreshTokens", () => {
  it("keeps the current refresh token when Accounts does not rotate it", async () => {
    const fetch = vi.fn(async () => Response.json({ access_token: "a2", expires_in: 600 }));
    await expect(refreshTokens(env, "r1", { fetch, now: () => 1000 })).resolves.toEqual({
      accessToken: "a2",
      refreshToken: "r1",
      expiresAt: 1600,
    });
  });

  it("tells a dead grant from an outage", async () => {
    const dead = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(refreshTokens(env, "r1", { fetch: dead })).rejects.toBeInstanceOf(
      UpstreamGrantError,
    );
    const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    await expect(refreshTokens(env, "r1", { fetch: down })).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    const offline = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(refreshTokens(env, "r1", { fetch: offline })).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });
});

describe("accessTokenTtl", () => {
  it("ends a minute before the upstream token, never below a minute", () => {
    expect(accessTokenTtl({ accessToken: "", refreshToken: "", expiresAt: 4600 }, 1000)).toBe(3540);
    expect(accessTokenTtl({ accessToken: "", refreshToken: "", expiresAt: 1010 }, 1000)).toBe(60);
  });
});
