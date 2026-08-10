import { describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  signInSocial: vi.fn(async () => new Response("ok")),
}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({
    handler: vi.fn(),
    api: { getSession: vi.fn(async () => null), signInSocial: authMock.signInSocial },
    $context: Promise.resolve({}),
  })),
}));

vi.mock("better-auth/plugins", () => ({ jwt: () => ({}) }));
vi.mock("@better-auth/oauth-provider", () => ({ oauthProvider: () => ({}) }));
vi.mock("../lib/db", () => ({ listActiveChaptersForUser: vi.fn(async () => []) }));

import { AUTH_HANDLER_TIMEOUT_MS, invalidateAuthCache } from "../lib/auth.server";
import { loader, redirectSocialResponse } from "./oauth.google.start";

describe("redirectSocialResponse", () => {
  it("turns Better Auth's successful social response into a browser redirect", () => {
    const response = redirectSocialResponse(
      Response.json(
        { url: "https://accounts.google.com/oauth", redirect: true },
        {
          headers: {
            Location: "https://accounts.google.com/oauth",
            "Set-Cookie": "oauth-state=signed; HttpOnly; SameSite=Lax",
          },
        },
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://accounts.google.com/oauth");
    expect(response.headers.get("Set-Cookie")).toContain("oauth-state=signed");
    expect(response.headers.get("X-Remix-Reload-Document")).toBe("true");
    expect(response.headers.get("Content-Type")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
  });

  it("passes through error responses without a redirect target", () => {
    const original = Response.json({ error: "invalid_request" }, { status: 400 });
    expect(redirectSocialResponse(original)).toBe(original);
  });
});

describe("Google OAuth start", () => {
  it("falls back to /signin with the caller's original return_to when sign-in stalls", async () => {
    invalidateAuthCache();
    vi.useFakeTimers();
    authMock.signInSocial.mockImplementation(() => new Promise(() => undefined));

    const pending = loader({
      request: new Request(
        "https://accounts.example/oauth/google/start?return_to=%2Fchapters%2Ftokyo",
      ),
      context: {
        cloudflare: {
          env: {
            APP_URL: "https://accounts.example",
            BETTER_AUTH_SECRET: "test-secret",
            GOOGLE_CLIENT_ID: "google-client",
            GOOGLE_CLIENT_SECRET: "google-secret",
            DB: {},
          },
        },
      },
    } as never) as Promise<Response>;
    await vi.advanceTimersByTimeAsync(AUTH_HANDLER_TIMEOUT_MS);
    const response = await pending;

    // Not the start route's own URL: nesting return_to would restart the
    // Google hop instead of returning the user where they asked to go.
    expect(response.headers.get("Location")).toBe("/signin?return_to=%2Fchapters%2Ftokyo");

    vi.useRealTimers();
    invalidateAuthCache();
  });
});
