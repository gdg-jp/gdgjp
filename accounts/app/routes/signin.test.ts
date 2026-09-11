import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({ getSessionUser: authMock.getSessionUser }));
vi.mock("~/lib/i18n/i18n.server", () => ({
  i18n: { getFixedT: vi.fn(async () => (key: string) => key) },
}));

import { loader } from "./signin";

async function redirectFrom(url: string): Promise<Response> {
  try {
    await loader({
      request: new Request(url),
      context: { cloudflare: { env: {} } },
    } as never);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected the loader to redirect");
}

describe("sign-in loader", () => {
  beforeEach(() => {
    authMock.getSessionUser.mockResolvedValue({ id: "user-1" });
  });

  it("resumes the provider authorization flow for an existing session", async () => {
    const response = await redirectFrom(
      "http://localhost:5173/signin?client_id=wiki&response_type=code" +
        "&redirect_uri=http%3A%2F%2Flocalhost%3A5177%2Fapi%2Fauth%2Fcallback%2Fgdgjp" +
        "&state=state-value&nonce=nonce-value",
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "", "http://localhost:5173");
    expect(location.pathname).toBe("/api/auth/oauth2/authorize");
    expect(location.searchParams.get("client_id")).toBe("wiki");
    expect(location.searchParams.get("state")).toBe("state-value");
  });

  it("keeps the ordinary return target for a non-OAuth sign-in", async () => {
    const response = await redirectFrom(
      "http://localhost:5173/signin?return_to=%2Fchapters%2Ftokyo",
    );

    expect(response.headers.get("Location")).toBe("/chapters/tokyo");
  });
});
