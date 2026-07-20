import { describe, expect, it } from "vitest";
import { redirectSocialResponse } from "./oauth.google.start";

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
