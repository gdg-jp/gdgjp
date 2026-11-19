import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  runAuthHandler: vi.fn(),
}));

vi.mock("~/features/auth/auth.server", () => ({
  runAuthHandler: authMocks.runAuthHandler,
}));

vi.mock("~/lib/i18n/i18n.server", () => ({
  i18n: {
    getFixedT: vi.fn(async () => (key: string) => key),
  },
}));

import { actOnOauthConsent } from "~/features/oauth/oauth-consent.server";

function consentRequest(accept: "true" | "false", oauthQuery = "client_id=c1&sig=s") {
  const form = new FormData();
  form.set("oauth_query", oauthQuery);
  form.set("accept", accept);
  return new Request("https://accounts.example/oauth/consent", {
    method: "POST",
    headers: {
      origin: "https://accounts.example",
      cookie: "gdgjp-accounts.session_token=tok",
    },
    body: form,
  });
}

describe("actOnOauthConsent", () => {
  beforeEach(() => {
    authMocks.runAuthHandler.mockReset();
  });

  it("redirects to the url returned by Better Auth 1.7 consent endpoint", async () => {
    authMocks.runAuthHandler.mockResolvedValue(
      Response.json({ redirect: true, url: "https://rp.example/callback?code=abc" }),
    );

    const thrown = await actOnOauthConsent({
      request: consentRequest("true"),
      context: { cloudflare: { env: {} as Env } },
    } as never).catch((value: unknown) => value);

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://rp.example/callback?code=abc");
    const forwarded = authMocks.runAuthHandler.mock.calls[0]?.[1] as Request;
    expect(forwarded.headers.get("origin")).toBe("https://accounts.example");
    expect(forwarded.headers.get("cookie")).toBe("gdgjp-accounts.session_token=tok");
  });

  it("falls back to redirect_uri when present", async () => {
    authMocks.runAuthHandler.mockResolvedValue(
      Response.json({ redirect_uri: "https://rp.example/callback?code=legacy" }),
    );

    const thrown = await actOnOauthConsent({
      request: consentRequest("true"),
      context: { cloudflare: { env: {} as Env } },
    } as never).catch((value: unknown) => value);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe(
      "https://rp.example/callback?code=legacy",
    );
  });

  it("returns 500 when the consent payload omits a redirect target", async () => {
    authMocks.runAuthHandler.mockResolvedValue(Response.json({ ok: true }));

    const response = await actOnOauthConsent({
      request: consentRequest("true"),
      context: { cloudflare: { env: {} as Env } },
    } as never);

    expect(response.status).toBe(500);
  });
});
