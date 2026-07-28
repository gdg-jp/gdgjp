import { describe, expect, it } from "vitest";

describe("X authorization", () => {
  it("requests the scopes required to identify and post as the authorized user", async () => {
    const { xAuthorizationUrl } = await import("./x.server");
    const url = await xAuthorizationUrl(
      {
        APP_URL: "http://localhost:5178",
        X_AUTHORIZATION_URL: "https://x.com/i/oauth2/authorize",
        X_CLIENT_ID: "client-id",
      },
      "state",
      "a-valid-pkce-verifier-which-is-long-enough-for-x-oauth",
    );
    expect(new URL(url).searchParams.get("scope")).toBe(
      "tweet.read tweet.write users.read offline.access media.write",
    );
  });
});
