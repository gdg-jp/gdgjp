import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SESSION_COOKIE, readSession } from "../src/auth/session";
import { renderHome } from "../src/pages/demo";
import { encryptedCookie, readEncryptedCookie } from "../src/platform/cookies";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

const request = new Request("https://demo.example.test/");
const secret = "a suitably long encryption secret";
const env = { IDP_ISSUER: "https://accounts.gdgs.jp", SESSION_SECRET: secret };

function withCookie(cookie: string): Request {
  return new Request(request, { headers: { Cookie: cookie.split(";")[0] } });
}

describe("session and presentation boundaries", () => {
  it("authenticates encrypted cookies and validates issuer and session expiry", async () => {
    const session = {
      claims: { name: "<Demo Member>" },
      exp: Date.now() + 60_000,
      idToken: "id-token",
      issuer: env.IDP_ISSUER,
      sub: "member-123",
    };
    const cookie = await encryptedCookie(SESSION_COOKIE, session, secret, 60, request);
    expect(cookie).toContain("Max-Age=60; Path=/; HttpOnly; SameSite=Lax; Secure");
    expect(await readSession(withCookie(cookie), env)).toEqual(session);
    expect(
      await readEncryptedCookie(withCookie(cookie), SESSION_COOKIE, "wrong-secret"),
    ).toBeNull();
    expect(
      await readSession(withCookie(cookie), { ...env, IDP_ISSUER: "https://other.test" }),
    ).toBeNull();
    const expired = await encryptedCookie(
      SESSION_COOKIE,
      { ...session, exp: 0 },
      secret,
      60,
      request,
    );
    expect(await readSession(withCookie(expired), env)).toBeNull();

    const body = await renderHome(request, true, session).text();
    expect(body).toContain("&lt;Demo Member&gt;");
    expect(body).not.toContain("<Demo Member>");
    const response = renderHome(request, false, null, 503);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toContain("https://demo.example.test/auth/callback");
  });
});
