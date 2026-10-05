import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHandler: vi.fn(async () => new Response("app response")),
  seedClients: vi.fn(async () => undefined),
  warmAuth: vi.fn(async () => undefined),
}));

vi.mock("react-router", () => ({ createRequestHandler: () => mocks.requestHandler }));
vi.mock("~/features/auth/auth.server", () => ({
  warmAuth: mocks.warmAuth,
}));
vi.mock("~/features/auth/seed-better-auth-als.server", () => ({
  seedBetterAuthAsyncLocalStorage: vi.fn(),
}));
vi.mock("~/features/oauth/seed-clients.server", () => ({ seedClients: mocks.seedClients }));

import worker from "../workers/app";

function context() {
  return { waitUntil: vi.fn() };
}

describe("accounts worker E2E authorization handling", () => {
  beforeEach(() => {
    mocks.requestHandler.mockClear();
  });

  it("routes E2E authorization through the provider so it can sign the login continuation", async () => {
    const request = new Request(
      "http://localhost:5173/api/auth/oauth2/authorize?client_id=wiki&response_type=code",
    );
    const response = await worker.fetch(
      request as never,
      { E2E_TEST_MODE: "true" } as never,
      context() as never,
    );

    expect(await response.text()).toBe("app response");
    expect(mocks.seedClients).toHaveBeenCalled();
    expect(mocks.requestHandler).toHaveBeenCalledWith(request, expect.any(Object));
  });

  it("routes normal authorization through the same provider", async () => {
    const request = new Request(
      "http://localhost:5173/api/auth/oauth2/authorize?client_id=wiki&response_type=code",
    );
    const response = await worker.fetch(request as never, {} as never, context() as never);

    expect(await response.text()).toBe("app response");
    expect(mocks.requestHandler).toHaveBeenCalledWith(request, expect.any(Object));
  });
});
