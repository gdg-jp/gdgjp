import { describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("~/lib/auth.server", () => ({ getSessionUser: authMock.getSessionUser }));

import { loader } from "./oauth.google-workspace.start";

function testContext() {
  return {
    cloudflare: {
      env: {
        APP_URL: "https://accounts.example",
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
        DB: fakeDb(),
      },
    },
  };
}

function fakeDb() {
  return {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement;
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return statement;
    },
  };
}

describe("Google Workspace connect start", () => {
  it("sends an unauthenticated visitor to sign in, preserving return_to", async () => {
    authMock.getSessionUser.mockResolvedValueOnce(null);
    const request = new Request(
      "https://accounts.example/oauth/google-workspace/start?return_to=%2Fsettings%2Fgoogle-workspace",
    );

    let response: Response | undefined;
    try {
      await loader({ request, context: testContext() } as never);
    } catch (thrown) {
      response = thrown as Response;
    }
    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe(
      "/signin?return_to=%2Foauth%2Fgoogle-workspace%2Fstart%3Freturn_to%3D%252Fsettings%252Fgoogle-workspace",
    );
  });

  it("redirects a signed-in user straight to Google's incremental-consent screen", async () => {
    authMock.getSessionUser.mockResolvedValueOnce({ id: "user-1", email: "a@b.com" });
    const request = new Request("https://accounts.example/oauth/google-workspace/start");

    const response = (await loader({ request, context: testContext() } as never)) as Response;
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("consent");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
  });
});
