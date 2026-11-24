import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { signPayload } from "./cookie";
import { initializeRpAuth } from "./rp";

const secret = "test-secret";
const app = "https://app.example";

type Accounts = (url: string) => Response | Promise<Response>;

function rp(issuer: string, accounts: Accounts) {
  const prepare = vi.fn(() => {
    throw new Error("D1 must not be used while Accounts is unreachable");
  });
  const idpFetch = vi.fn<typeof fetch>(async (input) =>
    accounts(input instanceof Request ? input.url : String(input)),
  );
  const instance = initializeRpAuth({
    db: { prepare } as unknown as D1Database,
    appUrl: app,
    cookiePrefix: "app",
    secret,
    idp: { url: issuer, clientId: "client", clientSecret: "client-secret", fetch: idpFetch },
  });
  return { instance, idpFetch, prepare };
}

const failures: Array<[string, Accounts]> = [
  [
    "a network error",
    () => {
      throw new TypeError("fetch failed");
    },
  ],
  ["a 502 response", () => new Response("Bad Gateway", { status: 502 })],
  ["a 503 response", () => Response.json({ error: "unavailable" }, { status: 503 })],
  ["a 404 response", () => new Response("Not Found", { status: 404 })],
  [
    "an HTML error page served as 200",
    () => new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } }),
  ],
];

async function expectUnavailablePage(response: Response, returnTo: string) {
  expect(response.status).toBe(503);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("retry-after")).toBe("5");
  expect(response.headers.get("set-cookie")).toMatch(/^app-oidc-tx=; Max-Age=0;/);
  const body = await response.text();
  expect(body).toContain("<title>サインインできませんでした</title>");
  expect(body).toContain("サインインサービスに接続できませんでした。しばらく待ってから、");
  expect(body).toContain(
    `<a href="${app}/api/auth/signin?return_to=${encodeURIComponent(returnTo)}">もう一度サインイン</a>してください。`,
  );
}

describe("sign-in while Accounts is unreachable", () => {
  it.each(failures)(
    "answers the sign-in start with a retry page on %s from discovery",
    async (label, accounts) => {
      const issuer = `https://signin-${label.toLowerCase().replace(/\W+/g, "-")}.example`;
      const { instance, idpFetch, prepare } = rp(issuer, accounts);

      const response = await instance.handleAuthRequest(
        new Request(`${app}/api/auth/signin?return_to=%2Fchapters%2Ftokyo%3Ftab%3D1`),
      );

      await expectUnavailablePage(response, `${app}/chapters/tokyo?tab=1`);
      expect(idpFetch).toHaveBeenCalled();
      expect(String(idpFetch.mock.calls[0][0])).toBe(`${issuer}/.well-known/openid-configuration`);
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it.each(failures)(
    "answers the callback with a retry page on %s from discovery",
    async (label, accounts) => {
      const issuer = `https://callback-${label.toLowerCase().replace(/\W+/g, "-")}.example`;
      const { instance, prepare } = rp(issuer, accounts);
      const tx = await signPayload(
        {
          codeVerifier: "verifier",
          state: "state",
          nonce: "nonce",
          returnTo: `${app}/after`,
          exp: Date.now() + 60_000,
        },
        secret,
      );

      const response = await instance.handleAuthRequest(
        new Request(`${app}/api/auth/callback/gdgjp?code=code&state=state`, {
          headers: { Cookie: `app-oidc-tx=${tx}; gdg_sid=idp-session-1` },
        }),
      );

      await expectUnavailablePage(response, `${app}/after`);
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("starts sign-in normally once Accounts answers again", async () => {
    const issuer = "https://recovering.example";
    let reachable = false;
    const { instance } = rp(issuer, () => {
      if (!reachable) throw new TypeError("fetch failed");
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
      });
    });

    const down = await instance.handleAuthRequest(new Request(`${app}/api/auth/signin`));
    await expectUnavailablePage(down, `${app}/`);

    reachable = true;
    const up = await instance.handleAuthRequest(new Request(`${app}/api/auth/signin`));
    expect(up.status).toBe(302);
    const location = new URL(up.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(`${issuer}/authorize`);
    expect(location.searchParams.get("redirect_uri")).toBe(`${app}/api/auth/callback/gdgjp`);
  });
});
