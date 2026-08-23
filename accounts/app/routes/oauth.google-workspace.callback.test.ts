import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("~/lib/auth.server", () => ({ getSessionUser: authMock.getSessionUser }));

const workspaceMock = vi.hoisted(() => ({ exchangeWorkspaceCode: vi.fn() }));
vi.mock("~/lib/google-workspace.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/google-workspace.server")>(
    "~/lib/google-workspace.server",
  );
  return { ...actual, exchangeWorkspaceCode: workspaceMock.exchangeWorkspaceCode };
});

import {
  GOOGLE_WORKSPACE_SCOPES,
  createWorkspaceOauthState,
  getWorkspaceConnection,
} from "~/lib/google-workspace.server";
import { loader } from "./oauth.google-workspace.callback";

const USER = { id: "user-1", email: "a@b.com" };

function testContext(db: unknown) {
  return {
    cloudflare: {
      env: {
        APP_URL: "https://accounts.example",
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
        GOOGLE_WORKSPACE_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(9)).toString("base64"),
        DB: db,
      },
    },
  };
}

type StateRow = {
  id: string;
  userId: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: string;
  expiresAt: string;
};
type ConnectionRow = {
  userId: string;
  refreshTokenCiphertext: string;
  refreshTokenNonce: string;
  encryptionKeyVersion: number;
  scope: string;
  connectedAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

function fakeDb() {
  const states: StateRow[] = [];
  const connections = new Map<string, ConnectionRow>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async run() {
          if (sql.startsWith("DELETE FROM googleWorkspaceOauthState WHERE expiresAt")) {
            const [now] = args as [string];
            for (let i = states.length - 1; i >= 0; i--) {
              if (states[i].expiresAt <= now) states.splice(i, 1);
            }
            return { success: true, meta: {} };
          }
          if (sql.startsWith("INSERT INTO googleWorkspaceOauthState")) {
            const [id, userId, codeVerifier, returnTo, createdAt, expiresAt] = args as string[];
            states.push({ id, userId, codeVerifier, returnTo, createdAt, expiresAt });
            return { success: true, meta: {} };
          }
          if (sql.startsWith("INSERT INTO googleWorkspaceConnection")) {
            const [userId, ciphertext, nonce, keyVersion, scope, connectedAt, updatedAt] = args as [
              string,
              string,
              string,
              number,
              string,
              string,
              string,
            ];
            const existing = connections.get(userId);
            connections.set(userId, {
              userId,
              refreshTokenCiphertext: ciphertext,
              refreshTokenNonce: nonce,
              encryptionKeyVersion: keyVersion,
              scope,
              connectedAt: existing ? existing.connectedAt : connectedAt,
              updatedAt,
              revokedAt: null,
            });
            return { success: true, meta: {} };
          }
          throw new Error(`unhandled run(): ${sql}`);
        },
        async first<T>(): Promise<T | null> {
          if (sql.startsWith("DELETE FROM googleWorkspaceOauthState WHERE id")) {
            const [id] = args as [string];
            const index = states.findIndex((s) => s.id === id);
            if (index === -1) return null;
            const [row] = states.splice(index, 1);
            return {
              userId: row.userId,
              codeVerifier: row.codeVerifier,
              returnTo: row.returnTo,
              expiresAt: row.expiresAt,
            } as T;
          }
          if (sql.startsWith("SELECT userId, refreshTokenCiphertext")) {
            const [userId] = args as [string];
            return (connections.get(userId) ?? null) as T | null;
          }
          throw new Error(`unhandled first(): ${sql}`);
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, connections };
}

function callbackRequest(params: Record<string, string>) {
  const url = new URL("https://accounts.example/oauth/google-workspace/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

async function catchRedirect(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
    throw new Error("expected loader to redirect");
  } catch (thrown) {
    return thrown as Response;
  }
}

beforeEach(() => {
  authMock.getSessionUser.mockReset();
  workspaceMock.exchangeWorkspaceCode.mockReset();
});

describe("Google Workspace connect callback", () => {
  it("stores the connection and redirects to returnTo on the happy path", async () => {
    authMock.getSessionUser.mockResolvedValue(USER);
    workspaceMock.exchangeWorkspaceCode.mockResolvedValue({
      ok: true,
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: GOOGLE_WORKSPACE_SCOPES,
      expiresIn: 3600,
    });
    const { db } = fakeDb();
    const created = await createWorkspaceOauthState(db, USER.id, "/settings/google-workspace");

    const response = await loader({
      request: callbackRequest({ code: "auth-code", state: created.state }),
      context: testContext(db),
    } as never);

    expect((response as Response).status).toBe(302);
    const location = (response as Response).headers.get("Location") ?? "";
    expect(location).toContain("/settings/google-workspace");
    expect(location).toContain("workspace=connected");
    expect(await getWorkspaceConnection(db, USER.id)).not.toBeNull();
  });

  it("preserves an absolute trusted sibling-origin returnTo on success", async () => {
    authMock.getSessionUser.mockResolvedValue(USER);
    workspaceMock.exchangeWorkspaceCode.mockResolvedValue({
      ok: true,
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: GOOGLE_WORKSPACE_SCOPES,
      expiresIn: 3600,
    });
    const { db } = fakeDb();
    const created = await createWorkspaceOauthState(db, USER.id, "https://wiki.gdgs.jp/settings");

    const response = await loader({
      request: callbackRequest({ code: "auth-code", state: created.state }),
      context: testContext(db),
    } as never);

    const location = (response as Response).headers.get("Location") ?? "";
    expect(location).toBe("https://wiki.gdgs.jp/settings?workspace=connected");
  });

  it("preserves an absolute trusted sibling-origin returnTo on error", async () => {
    authMock.getSessionUser.mockResolvedValue(USER);
    const { db } = fakeDb();
    const { state } = await createWorkspaceOauthState(db, USER.id, "https://wiki.gdgs.jp/settings");

    const response = await catchRedirect(
      loader({
        request: callbackRequest({ error: "access_denied", state }),
        context: testContext(db),
      } as never),
    );
    expect(response.headers.get("Location")).toBe(
      "https://wiki.gdgs.jp/settings?workspace=error&workspace_reason=access_denied",
    );
  });

  it("rejects a replayed state", async () => {
    authMock.getSessionUser.mockResolvedValue(USER);
    workspaceMock.exchangeWorkspaceCode.mockResolvedValue({
      ok: true,
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: GOOGLE_WORKSPACE_SCOPES,
      expiresIn: 3600,
    });
    const { db } = fakeDb();
    const { state } = await createWorkspaceOauthState(db, USER.id, "/dashboard");

    await loader({
      request: callbackRequest({ code: "auth-code", state }),
      context: testContext(db),
    } as never);

    const replay = await catchRedirect(
      loader({
        request: callbackRequest({ code: "auth-code", state }),
        context: testContext(db),
      } as never),
    );
    expect(replay.headers.get("Location")).toContain("workspace=error");
    expect(replay.headers.get("Location")).toContain("workspace_reason=state_invalid");
  });

  it("rejects a callback presented to a different session than the one that started the flow", async () => {
    const { db } = fakeDb();
    const { state } = await createWorkspaceOauthState(db, "starter-user", "/dashboard");

    authMock.getSessionUser.mockResolvedValue({ id: "different-user", email: "x@y.com" });
    const response = await catchRedirect(
      loader({
        request: callbackRequest({ code: "auth-code", state }),
        context: testContext(db),
      } as never),
    );
    expect(response.headers.get("Location")).toContain("workspace_reason=state_invalid");
    expect(workspaceMock.exchangeWorkspaceCode).not.toHaveBeenCalled();
  });

  it("surfaces a Google error callback (access_denied) without recording a connection", async () => {
    authMock.getSessionUser.mockResolvedValue(USER);
    const { db } = fakeDb();
    const { state } = await createWorkspaceOauthState(db, USER.id, "/dashboard");

    const response = await catchRedirect(
      loader({
        request: callbackRequest({ error: "access_denied", state }),
        context: testContext(db),
      } as never),
    );
    expect(response.headers.get("Location")).toContain("workspace_reason=access_denied");
    expect(await getWorkspaceConnection(db, USER.id)).toBeNull();
  });

  it("rejects a narrower-than-requested scope grant", async () => {
    authMock.getSessionUser.mockResolvedValue(USER);
    workspaceMock.exchangeWorkspaceCode.mockResolvedValue({
      ok: true,
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: ["https://www.googleapis.com/auth/userinfo.email"],
      expiresIn: 3600,
    });
    const { db } = fakeDb();
    const { state } = await createWorkspaceOauthState(db, USER.id, "/dashboard");

    const response = await catchRedirect(
      loader({
        request: callbackRequest({ code: "auth-code", state }),
        context: testContext(db),
      } as never),
    );
    expect(response.headers.get("Location")).toContain("workspace_reason=scope_narrowed");
    expect(await getWorkspaceConnection(db, USER.id)).toBeNull();
  });

  it("treats a missing refresh_token as a hard failure, not a token-less connection", async () => {
    authMock.getSessionUser.mockResolvedValue(USER);
    workspaceMock.exchangeWorkspaceCode.mockResolvedValue({
      ok: true,
      accessToken: "at",
      refreshToken: null,
      grantedScopes: GOOGLE_WORKSPACE_SCOPES,
      expiresIn: 3600,
    });
    const { db } = fakeDb();
    const { state } = await createWorkspaceOauthState(db, USER.id, "/dashboard");

    const response = await catchRedirect(
      loader({
        request: callbackRequest({ code: "auth-code", state }),
        context: testContext(db),
      } as never),
    );
    expect(response.headers.get("Location")).toContain("workspace_reason=missing_refresh_token");
    expect(await getWorkspaceConnection(db, USER.id)).toBeNull();
  });
});
