import { beforeEach, describe, expect, it, vi } from "vitest";

const jose = vi.hoisted(() => ({
  compactVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  decodeJwt: vi.fn(),
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("jose", () => jose);
vi.mock("./auth.server", () => ({ getAuth: () => ({ api: { signOut: auth.signOut } }) }));

import { handleOidcEndSession } from "./oidc-end-session.server";

const clientId = "demo-client";
const logoutUri = "https://demo.example/";

function env(client?: Record<string, unknown>) {
  const first = vi.fn().mockResolvedValue(
    client ?? {
      clientId,
      disabled: 0,
      enableEndSession: 1,
      postLogoutRedirectUris: JSON.stringify([logoutUri]),
    },
  );
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn(() => ({ first, run }));
  return {
    APP_URL: "https://accounts.example",
    DB: { prepare: vi.fn(() => ({ bind })) },
    _run: run,
  };
}

function tokenPayload(overrides: Record<string, unknown> = {}) {
  return new TextEncoder().encode(
    JSON.stringify({
      aud: clientId,
      iss: "https://accounts.example",
      sid: "session-1",
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  jose.decodeJwt.mockReturnValue({ aud: clientId });
  jose.compactVerify.mockResolvedValue({ payload: tokenPayload() });
  auth.signOut.mockResolvedValue(
    new Response(null, { headers: { "Set-Cookie": "session=; Max-Age=0" } }),
  );
});

describe("handleOidcEndSession", () => {
  it("accepts a GET request with an ID token and redirects to the registered URI", async () => {
    const testEnv = env();
    const response = await handleOidcEndSession(
      testEnv as unknown as Env,
      new Request(
        `https://accounts.example/api/auth/oauth2/end-session?id_token_hint=token&post_logout_redirect_uri=${encodeURIComponent(logoutUri)}&state=logout-state`,
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${logoutUri}?state=logout-state`);
    expect(testEnv._run).toHaveBeenCalledOnce();
  });

  it("accepts POST form serialization", async () => {
    const response = await handleOidcEndSession(
      env() as unknown as Env,
      new Request("https://accounts.example/api/auth/oauth2/end-session", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `id_token_hint=token&post_logout_redirect_uri=${encodeURIComponent(logoutUri)}`,
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(logoutUri);
  });

  it("requires confirmation instead of rejecting a hint-less client logout", async () => {
    const response = await handleOidcEndSession(
      env() as unknown as Env,
      new Request(
        `https://accounts.example/api/auth/oauth2/end-session?client_id=${clientId}&post_logout_redirect_uri=${encodeURIComponent(logoutUri)}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Sign out of GDG Japan Accounts?");
  });

  it("completes a confirmed hint-less POST logout", async () => {
    const response = await handleOidcEndSession(
      env() as unknown as Env,
      new Request("https://accounts.example/api/auth/oauth2/end-session", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `client_id=${clientId}&post_logout_redirect_uri=${encodeURIComponent(logoutUri)}&confirm=true`,
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Set-Cookie")).toContain("session=");
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("rejects a client_id that differs from the ID token audience", async () => {
    const response = await handleOidcEndSession(
      env() as unknown as Env,
      new Request(
        "https://accounts.example/api/auth/oauth2/end-session?id_token_hint=token&client_id=other-client",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("rejects an unregistered post-logout redirect URI", async () => {
    const response = await handleOidcEndSession(
      env() as unknown as Env,
      new Request(
        "https://accounts.example/api/auth/oauth2/end-session?client_id=demo-client&post_logout_redirect_uri=https%3A%2F%2Fevil.example%2F",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });
});
