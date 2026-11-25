import { describe, expect, it } from "vitest";
import { signedInDestination } from "~/features/auth/auth-redirect";

function signin(params: Record<string, string>): URL {
  return new URL(`https://accounts.example/signin?${new URLSearchParams(params)}`);
}

describe("signedInDestination", () => {
  it("resumes an OAuth authorization request instead of abandoning it at Accounts", () => {
    const params = {
      client_id: "wiki",
      response_type: "code",
      redirect_uri: "http://localhost:5177/api/auth/callback/gdgjp",
      scope: "openid email profile",
      state: "state-value",
      nonce: "nonce-value",
    };

    const destination = new URL(signedInDestination(signin(params)), "http://localhost:5173");

    expect(destination.pathname).toBe("/api/auth/oauth2/authorize");
    expect(destination.searchParams.get("client_id")).toBe("wiki");
    expect(destination.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5177/api/auth/callback/gdgjp",
    );
    expect(destination.searchParams.get("state")).toBe("state-value");
    expect(destination.searchParams.get("nonce")).toBe("nonce-value");
  });

  it("keeps the normal signed-in return target behavior", () => {
    expect(signedInDestination(signin({ return_to: "/chapters/tokyo?tab=1#roles" }))).toBe(
      "/chapters/tokyo?tab=1#roles",
    );
    expect(
      signedInDestination(signin({ return_to: "https://accounts.example/chapters/tokyo" })),
    ).toBe("/chapters/tokyo");
    expect(signedInDestination(signin({}))).toBe("/dashboard");
  });

  it.each([
    "https://example.com",
    "https://wiki.gdgs.jp/settings",
    "/\t/evil.example",
    "/\r\n/evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "//evil.example",
    "/.//evil.example",
    "javascript:alert(1)",
  ])("never leaves Accounts for the return target %j", (returnTo) => {
    expect(signedInDestination(signin({ return_to: returnTo }))).toBe("/dashboard");
  });
});
