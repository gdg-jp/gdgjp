import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("~/lib/auth.server", () => ({ requireUser: authMock.requireUser }));

const workspaceMock = vi.hoisted(() => ({
  getWorkspaceConnection: vi.fn(),
  decryptRefreshToken: vi.fn(),
  revokeGoogleToken: vi.fn(),
  revokeWorkspaceConnection: vi.fn(),
}));
vi.mock("~/lib/google-workspace.server", () => workspaceMock);

import { action } from "./settings.google-workspace";

const USER = { id: "user-1", email: "a@b.com" };

function testContext() {
  return { cloudflare: { env: { DB: {} } } };
}

function disconnectRequest(intent = "disconnect") {
  const form = new URLSearchParams({ intent });
  return new Request("https://accounts.example/settings/google-workspace", {
    method: "POST",
    body: form,
  });
}

const ACTIVE_CONNECTION = {
  userId: USER.id,
  refreshTokenCiphertext: "ciphertext",
  refreshTokenNonce: "nonce",
  encryptionKeyVersion: 1,
  scope: "scope-a",
  connectedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
};

beforeEach(() => {
  authMock.requireUser.mockReset();
  workspaceMock.getWorkspaceConnection.mockReset();
  workspaceMock.decryptRefreshToken.mockReset();
  workspaceMock.revokeGoogleToken.mockReset();
  workspaceMock.revokeWorkspaceConnection.mockReset();
});

describe("Google Workspace settings action", () => {
  it("redirects an unauthenticated caller to sign in", async () => {
    authMock.requireUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));

    let response: Response | undefined;
    try {
      await action({ request: disconnectRequest(), context: testContext() } as never);
    } catch (thrown) {
      response = thrown as Response;
    }
    expect(response?.status).toBe(302);
  });

  it("ignores an unrelated intent without touching the connection", async () => {
    authMock.requireUser.mockResolvedValue(USER);

    const result = await action({
      request: disconnectRequest("noop"),
      context: testContext(),
    } as never);

    expect(result).toEqual({ ok: false });
    expect(workspaceMock.getWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("does nothing when there is no active connection to disconnect", async () => {
    authMock.requireUser.mockResolvedValue(USER);
    workspaceMock.getWorkspaceConnection.mockResolvedValue(null);

    const result = await action({ request: disconnectRequest(), context: testContext() } as never);

    expect(result).toEqual({ ok: true });
    expect(workspaceMock.decryptRefreshToken).not.toHaveBeenCalled();
    expect(workspaceMock.revokeWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("revokes with Google and marks the local row revoked on the happy path", async () => {
    authMock.requireUser.mockResolvedValue(USER);
    workspaceMock.getWorkspaceConnection.mockResolvedValue(ACTIVE_CONNECTION);
    workspaceMock.decryptRefreshToken.mockResolvedValue("plaintext-refresh-token");

    const result = await action({ request: disconnectRequest(), context: testContext() } as never);

    expect(result).toEqual({ ok: true });
    expect(workspaceMock.revokeGoogleToken).toHaveBeenCalledWith(
      expect.anything(),
      "plaintext-refresh-token",
    );
    expect(workspaceMock.revokeWorkspaceConnection).toHaveBeenCalledWith(
      expect.anything(),
      USER.id,
    );
  });

  it("still marks the local row revoked when decrypting the stored token fails", async () => {
    authMock.requireUser.mockResolvedValue(USER);
    workspaceMock.getWorkspaceConnection.mockResolvedValue(ACTIVE_CONNECTION);
    workspaceMock.decryptRefreshToken.mockRejectedValue(new Error("bad ciphertext"));

    const result = await action({ request: disconnectRequest(), context: testContext() } as never);

    expect(result).toEqual({ ok: true });
    expect(workspaceMock.revokeGoogleToken).not.toHaveBeenCalled();
    expect(workspaceMock.revokeWorkspaceConnection).toHaveBeenCalledWith(
      expect.anything(),
      USER.id,
    );
  });

  it("still marks the local row revoked when Google's revoke call throws", async () => {
    authMock.requireUser.mockResolvedValue(USER);
    workspaceMock.getWorkspaceConnection.mockResolvedValue(ACTIVE_CONNECTION);
    workspaceMock.decryptRefreshToken.mockResolvedValue("plaintext-refresh-token");
    workspaceMock.revokeGoogleToken.mockRejectedValue(new Error("network error"));

    const result = await action({ request: disconnectRequest(), context: testContext() } as never);

    expect(result).toEqual({ ok: true });
    expect(workspaceMock.revokeWorkspaceConnection).toHaveBeenCalledWith(
      expect.anything(),
      USER.id,
    );
  });
});
