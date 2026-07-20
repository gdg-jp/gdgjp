import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDeveloperOAuthApi } from "./developer-oauth-api.server";
import {
  createDeveloperClient,
  getDeveloperClient,
  listDeveloperClients,
  updateDeveloperClient,
} from "./oauth-clients.server";

vi.mock("./oauth-clients.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("./oauth-clients.server")>();
  return {
    ...original,
    createDeveloperClient: vi.fn(),
    deleteDeveloperClient: vi.fn(),
    getDeveloperClient: vi.fn(),
    listDeveloperClients: vi.fn(),
    rotateDeveloperClientSecret: vi.fn(),
    updateDeveloperClient: vi.fn(),
  };
});

const client = {
  clientId: "client-1",
  name: "Example",
  appUrl: "https://example.com",
  redirectUris: ["https://example.com/callback"],
  postLogoutRedirectUris: ["https://example.com/signed-out"],
  scopes: ["openid", "email"] as const,
  disabled: false,
  createdAt: "2026-07-16T00:00:00.000Z",
};

describe("developer OAuth management API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves non-management OAuth routes to Better Auth", async () => {
    const response = await handleDeveloperOAuthApi(
      {} as Env,
      new Request("https://accounts.example/api/auth/oauth2/authorize"),
    );
    expect(response).toBeNull();
  });

  it("rejects attempts to register a public client", async () => {
    const response = await handleDeveloperOAuthApi(
      {} as Env,
      post("/api/auth/oauth2/create-client", {
        client_name: "Example",
        redirect_uris: ["https://example.com/callback"],
        token_endpoint_auth_method: "none",
      }),
    );
    expect(response?.status).toBe(400);
    expect(createDeveloperClient).not.toHaveBeenCalled();
  });

  it("returns a newly issued secret once with no-store headers", async () => {
    vi.mocked(createDeveloperClient).mockResolvedValue({
      client: { ...client, scopes: [...client.scopes] },
      clientSecret: "secret",
    });
    const response = await handleDeveloperOAuthApi(
      {} as Env,
      post("/api/auth/oauth2/create-client", {
        client_name: "Example",
        client_uri: "https://example.com",
        redirect_uris: ["https://example.com/callback"],
        scope: "openid email",
      }),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    await expect(response?.json()).resolves.toMatchObject({
      client_id: "client-1",
      client_secret: "secret",
      token_endpoint_auth_method: "client_secret_basic",
      require_pkce: true,
    });
  });

  it("returns only the current owner's filtered clients", async () => {
    vi.mocked(listDeveloperClients).mockResolvedValue([{ ...client, scopes: [...client.scopes] }]);
    const response = await handleDeveloperOAuthApi(
      {} as Env,
      new Request("https://accounts.example/api/auth/oauth2/get-clients"),
    );
    expect(listDeveloperClients).toHaveBeenCalledOnce();
    await expect(response?.json()).resolves.toEqual([
      expect.objectContaining({ client_id: "client-1", scope: "openid email" }),
    ]);
  });

  it("merges partial updates before applying validation", async () => {
    vi.mocked(getDeveloperClient).mockResolvedValue({ ...client, scopes: [...client.scopes] });
    vi.mocked(updateDeveloperClient).mockResolvedValue({
      ...client,
      name: "Renamed",
      scopes: [...client.scopes],
    });
    await handleDeveloperOAuthApi(
      {} as Env,
      post("/api/auth/oauth2/update-client", {
        client_id: "client-1",
        update: { client_name: "Renamed" },
      }),
    );
    expect(updateDeveloperClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      "client-1",
      expect.objectContaining({
        name: "Renamed",
        redirectUris: client.redirectUris,
        scopes: client.scopes,
      }),
    );
  });
});

function post(path: string, body: unknown) {
  return new Request(`https://accounts.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
