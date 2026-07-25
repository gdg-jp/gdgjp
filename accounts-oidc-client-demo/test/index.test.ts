import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

const oidc = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  buildEndSessionUrl: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  discovery: vi.fn(),
  fetchUserInfo: vi.fn(),
  randomNonce: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  randomState: vi.fn(),
}));

vi.mock("openid-client", () => oidc);

import worker from "../src/index";

const env = {
  IDP_CLIENT_ID: "demo-client",
  IDP_CLIENT_SECRET: "demo-secret",
  IDP_ISSUER: "https://accounts.gdgs.jp",
  SESSION_SECRET: "a suitably long session secret for test coverage",
};
const issuer = {
  serverMetadata: () => ({ issuer: "https://accounts.gdgs.jp" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  oidc.discovery.mockResolvedValue(issuer);
  oidc.randomPKCECodeVerifier.mockReturnValue("verifier");
  oidc.calculatePKCECodeChallenge.mockResolvedValue("challenge");
  oidc.randomState.mockReturnValue("state-value");
  oidc.randomNonce.mockReturnValue("nonce-value");
  oidc.buildAuthorizationUrl.mockReturnValue(
    new URL("https://accounts.gdgs.jp/api/auth/oauth2/authorize?test=1"),
  );
  oidc.buildEndSessionUrl.mockReturnValue(
    new URL("https://accounts.gdgs.jp/api/auth/oauth2/end-session?test=1"),
  );
});

describe("OIDC demo Worker", () => {
  it("builds an authorization-code PKCE login request and writes an encrypted transaction", async () => {
    const response = await worker.fetch(new Request("https://demo.workers.dev/auth/login"), env);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/authorize");
    expect(response.headers.get("Set-Cookie")).toContain("gdgjp-oidc-demo-transaction=");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith(
      issuer,
      expect.objectContaining({
        code_challenge: "challenge",
        code_challenge_method: "S256",
        nonce: "nonce-value",
        redirect_uri: "https://demo.workers.dev/auth/callback",
        scope: "openid email profile https://gdgs.jp/scopes/chapters",
        state: "state-value",
      }),
    );
  });

  it("rejects a callback without an OIDC transaction", async () => {
    const response = await worker.fetch(
      new Request("https://demo.workers.dev/auth/callback?code=code"),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("missing, invalid, or expired");
    expect(oidc.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it("creates a local session after a valid callback", async () => {
    oidc.authorizationCodeGrant.mockResolvedValue({
      access_token: "access-token",
      claims: () => ({ sub: "user-123" }),
      id_token: "id-token",
    });
    oidc.fetchUserInfo.mockResolvedValue({
      email: "member@example.test",
      name: "Demo Member",
      "https://gdgs.jp/claims/chapters": [{ chapterSlug: "tokyo", role: "organizer" }],
    });
    const login = await worker.fetch(new Request("https://demo.workers.dev/auth/login"), env);
    const transaction = login.headers.get("Set-Cookie")?.split(";")[0];
    const response = await worker.fetch(
      new Request("https://demo.workers.dev/auth/callback?code=code", {
        headers: { Cookie: transaction as string },
      }),
      env,
    );

    expect(response.status).toBe(302);
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("gdgjp-oidc-demo-session=")),
    ).toBe(true);
    expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(
      issuer,
      expect.any(URL),
      expect.objectContaining({
        expectedNonce: "nonce-value",
        expectedState: "state-value",
        pkceCodeVerifier: "verifier",
      }),
    );
  });

  it("clears the local session and redirects to the OIDC end-session endpoint", async () => {
    oidc.authorizationCodeGrant.mockResolvedValue({
      access_token: "access-token",
      claims: () => ({ sub: "user-123" }),
      id_token: "id-token",
    });
    oidc.fetchUserInfo.mockResolvedValue({ email: "member@example.test" });
    const login = await worker.fetch(new Request("https://demo.workers.dev/auth/login"), env);
    const transaction = login.headers.get("Set-Cookie")?.split(";")[0];
    const callback = await worker.fetch(
      new Request("https://demo.workers.dev/auth/callback?code=code", {
        headers: { Cookie: transaction as string },
      }),
      env,
    );
    const session = callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("gdgjp-oidc-demo-session="))
      ?.split(";")[0];
    const response = await worker.fetch(
      new Request("https://demo.workers.dev/auth/logout", {
        headers: { Cookie: session as string },
      }),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("end-session");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(oidc.buildEndSessionUrl).toHaveBeenCalledWith(
      issuer,
      expect.objectContaining({
        client_id: "demo-client",
        id_token_hint: "id-token",
        post_logout_redirect_uri: "https://demo.workers.dev/",
      }),
    );
  });
});
