import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requestHandler: vi.fn(async () => new Response("app response")),
  seedClients: vi.fn(async () => undefined),
  warmAuth: vi.fn(async () => undefined),
}));

vi.mock("react-router", () => ({ createRequestHandler: () => mocks.requestHandler }));
vi.mock("./lib/auth.server", () => ({
  getSessionUser: mocks.getSessionUser,
  warmAuth: mocks.warmAuth,
}));
vi.mock("./lib/seed-better-auth-als.server", () => ({
  seedBetterAuthAsyncLocalStorage: vi.fn(),
}));
vi.mock("./lib/seed-clients.server", () => ({ seedClients: mocks.seedClients }));

import worker from "../workers/app";

function context() {
  return { waitUntil: vi.fn() };
}

describe("accounts worker E2E authorization handling", () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
    mocks.requestHandler.mockClear();
  });

  it("keeps the deterministic sign-in redirect for an unauthenticated E2E request", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await worker.fetch(
      new Request(
        "http://localhost:5173/api/auth/oauth2/authorize?client_id=wiki&response_type=code",
      ) as never,
      { E2E_TEST_MODE: "true" } as never,
      context() as never,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/signin?client_id=wiki&response_type=code",
    );
    expect(mocks.requestHandler).not.toHaveBeenCalled();
  });

  it("lets an authenticated E2E request continue through the OAuth provider", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "user-1" });
    const request = new Request(
      "http://localhost:5173/api/auth/oauth2/authorize?client_id=wiki&response_type=code",
    );
    const response = await worker.fetch(
      request as never,
      { E2E_TEST_MODE: "true" } as never,
      context() as never,
    );

    expect(await response.text()).toBe("app response");
    expect(mocks.requestHandler).toHaveBeenCalledWith(request, expect.any(Object));
  });
});
