import { describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  handler: vi.fn(async () => new Response("ok")),
  betterAuth: vi.fn(),
}));

vi.mock("better-auth", () => ({
  betterAuth: authMock.betterAuth.mockImplementation(() => ({
    handler: authMock.handler,
    api: { getSession: vi.fn(async () => null) },
    $context: Promise.resolve({}),
  })),
}));

vi.mock("better-auth/plugins", () => ({ jwt: () => ({}) }));
vi.mock("@better-auth/oauth-provider", () => ({ oauthProvider: () => ({}) }));
vi.mock("../lib/db", () => ({ listActiveChaptersForUser: vi.fn(async () => []) }));

import { AUTH_HANDLER_TIMEOUT_MS, invalidateAuthCache } from "../lib/auth.server";
import { loader } from "./oauth.google.callback";

function testContext() {
  return {
    cloudflare: {
      env: {
        APP_URL: "https://accounts.example",
        BETTER_AUTH_SECRET: "test-secret",
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
        DB: {},
      },
    },
  };
}

const CALLBACK_URL =
  "https://accounts.example/oauth/google/callback?code=single-use-code&state=abc";

describe("Google OAuth callback", () => {
  it("starts sign-in over rather than replaying the consumed code when the handler stalls", async () => {
    invalidateAuthCache();
    vi.useFakeTimers();
    authMock.handler.mockImplementation(() => new Promise(() => undefined));

    const pending = loader({
      request: new Request(CALLBACK_URL),
      context: testContext(),
    } as never) as Promise<Response>;
    await vi.advanceTimersByTimeAsync(AUTH_HANDLER_TIMEOUT_MS);
    const response = await pending;

    expect(response.status).toBe(302);
    // The authorization code is single-use, so it must not be carried into
    // return_to — the user has to restart the flow from a bare /signin.
    expect(response.headers.get("Location")).toBe("/signin");

    vi.useRealTimers();
    invalidateAuthCache();
  });

  it("passes a settled handler response through untouched", async () => {
    invalidateAuthCache();
    const ok = new Response(null, { status: 302, headers: { Location: "/dashboard" } });
    authMock.handler.mockImplementation(async () => ok);

    const response = (await loader({
      request: new Request(CALLBACK_URL),
      context: testContext(),
    } as never)) as Response;

    expect(response).toBe(ok);
    invalidateAuthCache();
  });
});
