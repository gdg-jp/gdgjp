import { describe, expect, it } from "vitest";
import { signedInDestination } from "./auth-redirect";

describe("signedInDestination", () => {
  it("resumes an OAuth authorization request instead of abandoning it at Accounts", () => {
    const params = new URLSearchParams({
      client_id: "wiki",
      response_type: "code",
      redirect_uri: "http://localhost:5177/api/auth/callback/gdgjp",
      scope: "openid email profile",
      state: "state-value",
      nonce: "nonce-value",
    });

    const destination = new URL(signedInDestination(params), "http://localhost:5173");

    expect(destination.pathname).toBe("/api/auth/oauth2/authorize");
    expect(destination.searchParams.get("client_id")).toBe("wiki");
    expect(destination.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5177/api/auth/callback/gdgjp",
    );
    expect(destination.searchParams.get("state")).toBe("state-value");
    expect(destination.searchParams.get("nonce")).toBe("nonce-value");
  });

  it("keeps the normal signed-in return target behavior", () => {
    expect(signedInDestination(new URLSearchParams({ return_to: "/chapters/tokyo" }))).toBe(
      "/chapters/tokyo",
    );
  });

  it("rejects an untrusted non-OAuth return target", () => {
    expect(signedInDestination(new URLSearchParams({ return_to: "https://example.com" }))).toBe(
      "/dashboard",
    );
  });
});
