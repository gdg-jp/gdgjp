import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_GRANT_TYPE,
  MAX_PENDING_DEVICE_CODES_PER_CLIENT,
  MAX_PENDING_DEVICE_CODES_PER_IP,
  approveDeviceCode,
  denyDeviceCode,
  findPendingDeviceCodeByUserCode,
  handleDeviceAuthorizationRequest,
  handleDeviceTokenGrant,
} from "./device-authorization.server";

type ClientRow = {
  clientId: string;
  disabled: number;
  grantTypes: string;
  scopes: string;
  redirectUris: string;
  name: string;
};

type DeviceRow = {
  id: string;
  deviceCodeHash: string;
  userCodeHash: string;
  clientId: string;
  scope: string;
  codeVerifier: string;
  status: "pending" | "denied" | "completed";
  userId: string | null;
  authorizationCode: string | null;
  intervalSeconds: number;
  lastPolledAt: string | null;
  expiresAt: string;
  createdAt: string;
  ipHash: string | null;
};

const GDG_CLI: ClientRow = {
  clientId: "gdg-cli",
  disabled: 0,
  grantTypes: JSON.stringify(["authorization_code", "refresh_token", DEVICE_GRANT_TYPE]),
  scopes: JSON.stringify(["openid", "offline_access", "https://gdgs.jp/scopes/cli"]),
  redirectUris: JSON.stringify(["http://127.0.0.1:8787/callback"]),
  name: "GDG Japan CLI",
};

function createFakeEnv(clients: ClientRow[] = [GDG_CLI]) {
  const deviceCodes: DeviceRow[] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes("SELECT COUNT(*) AS count") && sql.includes("clientId = ? AND status")) {
            const [clientId] = args as [string];
            const count = deviceCodes.filter(
              (d) => d.clientId === clientId && d.status === "pending",
            ).length;
            return { count } as T;
          }
          if (sql.includes("SELECT COUNT(*) AS count") && sql.includes("ipHash = ? AND status")) {
            const [ipHash] = args as [string];
            const count = deviceCodes.filter(
              (d) => d.ipHash === ipHash && d.status === "pending",
            ).length;
            return { count } as T;
          }
          if (sql.includes("SELECT redirectUris FROM oauthClient")) {
            const client = clients.find((c) => c.clientId === args[0]);
            return (client ? { redirectUris: client.redirectUris } : null) as T | null;
          }
          if (sql.includes("FROM oauthClient WHERE clientId")) {
            const client = clients.find((c) => c.clientId === args[0]);
            return (
              client
                ? {
                    clientId: client.clientId,
                    disabled: client.disabled,
                    grantTypes: client.grantTypes,
                    scopes: client.scopes,
                  }
                : null
            ) as T | null;
          }
          if (sql.includes("JOIN oauthClient")) {
            const [userCodeHash, now] = args as [string, string];
            const row = deviceCodes.find(
              (d) => d.userCodeHash === userCodeHash && d.status === "pending" && d.expiresAt > now,
            );
            if (!row) return null;
            const client = clients.find((c) => c.clientId === row.clientId);
            return {
              id: row.id,
              clientId: row.clientId,
              scope: row.scope,
              clientName: client?.name ?? null,
            } as T;
          }
          if (sql.includes("DELETE FROM oauthDeviceCode") && sql.includes("RETURNING")) {
            const [id] = args as [string];
            const index = deviceCodes.findIndex((d) => d.id === id && d.status === "completed");
            if (index < 0) return null;
            const [row] = deviceCodes.splice(index, 1);
            return {
              clientId: row?.clientId,
              scope: row?.scope,
              codeVerifier: row?.codeVerifier,
              authorizationCode: row?.authorizationCode,
            } as T;
          }
          if (sql.includes("WHERE deviceCodeHash = ? AND clientId = ?")) {
            const [hash, clientId] = args as [string, string];
            const row = deviceCodes.find(
              (d) => d.deviceCodeHash === hash && d.clientId === clientId,
            );
            return (row as T) ?? null;
          }
          if (sql.includes("WHERE id = ? AND status = 'pending' AND expiresAt > ?")) {
            const [id, now] = args as [string, string];
            const row = deviceCodes.find(
              (d) => d.id === id && d.status === "pending" && d.expiresAt > now,
            );
            return (row as T) ?? null;
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO oauthDeviceCode")) {
            const [
              id,
              deviceCodeHash,
              userCodeHash,
              clientId,
              scope,
              codeVerifier,
              intervalSeconds,
              expiresAt,
              createdAt,
              ipHash,
            ] = args as [
              string,
              string,
              string,
              string,
              string,
              string,
              number,
              string,
              string,
              string | null,
            ];
            deviceCodes.push({
              id,
              deviceCodeHash,
              userCodeHash,
              clientId,
              scope,
              codeVerifier,
              status: "pending",
              userId: null,
              authorizationCode: null,
              intervalSeconds,
              lastPolledAt: null,
              expiresAt,
              createdAt,
              ipHash,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM oauthDeviceCode WHERE expiresAt <= ?")) {
            const [now] = args as [string];
            const before = deviceCodes.length;
            for (let i = deviceCodes.length - 1; i >= 0; i--) {
              const row = deviceCodes[i];
              if (row && row.expiresAt <= now) deviceCodes.splice(i, 1);
            }
            return { meta: { changes: before - deviceCodes.length } };
          }
          if (sql.startsWith("DELETE FROM oauthDeviceCode")) {
            const [id] = args as [string];
            const index = deviceCodes.findIndex((d) => d.id === id);
            if (index >= 0) deviceCodes.splice(index, 1);
            return { meta: { changes: index >= 0 ? 1 : 0 } };
          }
          if (sql.includes("SET intervalSeconds = ?, lastPolledAt = ?")) {
            const [interval, lastPolledAt, id] = args as [number, string, string];
            const row = deviceCodes.find((d) => d.id === id);
            if (row) {
              row.intervalSeconds = interval;
              row.lastPolledAt = lastPolledAt;
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET lastPolledAt = ?")) {
            const [lastPolledAt, id] = args as [string, string];
            const row = deviceCodes.find((d) => d.id === id);
            if (row) row.lastPolledAt = lastPolledAt;
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'denied'")) {
            const [id] = args as [string];
            const row = deviceCodes.find((d) => d.id === id && d.status === "pending");
            if (row) row.status = "denied";
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'completed'")) {
            const [userId, authorizationCode, id] = args as [string, string, string];
            const row = deviceCodes.find((d) => d.id === id && d.status === "pending");
            if (row) {
              row.status = "completed";
              row.userId = userId;
              row.authorizationCode = authorizationCode;
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };
  const env = { DB: db, APP_URL: "https://accounts.example" } as unknown as Env;
  return { env, deviceCodes, clients };
}

function deviceAuthRequest(body: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request("https://accounts.example/api/auth/oauth2/device_authorization", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

function tokenRequest(body: Record<string, string>) {
  return new Request("https://accounts.example/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

describe("handleDeviceAuthorizationRequest", () => {
  it("rejects an unknown client", async () => {
    const { env } = createFakeEnv();
    const response = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "nope" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({ error: "invalid_client" });
  });

  it("rejects a client that isn't allowed the device grant", async () => {
    const webClient: ClientRow = {
      ...GDG_CLI,
      clientId: "web",
      grantTypes: JSON.stringify(["authorization_code"]),
    };
    const { env } = createFakeEnv([webClient]);
    const response = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "web" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "unauthorized_client",
    });
  });

  it("issues a device_code/user_code pair for an allowed client", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const response = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli", scope: "openid https://gdgs.jp/scopes/cli" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    };
    expect(body.device_code).toBeTruthy();
    expect(body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.verification_uri).toBe("https://accounts.example/device");
    expect(body.verification_uri_complete).toContain(encodeURIComponent(body.user_code));
    expect(body.expires_in).toBe(600);
    expect(body.interval).toBe(5);
    expect(deviceCodes).toHaveLength(1);
    expect(deviceCodes[0]?.status).toBe("pending");
    expect(deviceCodes[0]?.scope).toBe("openid https://gdgs.jp/scopes/cli");
  });

  it("stores an empty scope when every requested scope is filtered out", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const response = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli", scope: "not-a-real-scope" }),
    );
    expect(response.status).toBe(200);
    expect(deviceCodes[0]?.scope).toBe("");
  });

  it("sweeps rows past their expiresAt on every request, regardless of which device_code", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const past = new Date(Date.now() - 60_000).toISOString();
    deviceCodes.push({
      id: "stale-id",
      deviceCodeHash: "stale-device-hash",
      userCodeHash: "stale-user-hash",
      clientId: "gdg-cli",
      scope: "openid",
      codeVerifier: "verifier",
      status: "pending",
      userId: null,
      authorizationCode: null,
      intervalSeconds: 5,
      lastPolledAt: null,
      expiresAt: past,
      createdAt: past,
      ipHash: null,
    });

    await handleDeviceAuthorizationRequest(env, deviceAuthRequest({ client_id: "gdg-cli" }));

    expect(deviceCodes.find((d) => d.id === "stale-id")).toBeUndefined();
    expect(deviceCodes).toHaveLength(1);
  });

  it("rejects once a client has too many pending device codes", async () => {
    const { env } = createFakeEnv();
    for (let i = 0; i < MAX_PENDING_DEVICE_CODES_PER_CLIENT; i++) {
      const response = await handleDeviceAuthorizationRequest(
        env,
        deviceAuthRequest({ client_id: "gdg-cli" }, { "cf-connecting-ip": `10.0.0.${i}` }),
      );
      expect(response.status).toBe(200);
    }
    const response = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }, { "cf-connecting-ip": "10.0.0.999" }),
    );
    expect(response.status).toBe(429);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "temporarily_unavailable",
    });
  });

  it("rejects once a single address has too many pending device codes", async () => {
    const { env } = createFakeEnv();
    for (let i = 0; i < MAX_PENDING_DEVICE_CODES_PER_IP; i++) {
      const response = await handleDeviceAuthorizationRequest(
        env,
        deviceAuthRequest({ client_id: "gdg-cli" }, { "cf-connecting-ip": "203.0.113.5" }),
      );
      expect(response.status).toBe(200);
    }
    const response = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }, { "cf-connecting-ip": "203.0.113.5" }),
    );
    expect(response.status).toBe(429);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "temporarily_unavailable",
    });
  });
});

describe("handleDeviceTokenGrant", () => {
  it("returns null for non-device grant types so the caller can fall through", async () => {
    const { env } = createFakeEnv();
    const response = await handleDeviceTokenGrant(
      env,
      tokenRequest({ grant_type: "authorization_code" }),
      vi.fn(),
    );
    expect(response).toBeNull();
  });

  it("returns expired_token for an unknown device_code", async () => {
    const { env } = createFakeEnv();
    const response = await handleDeviceTokenGrant(
      env,
      tokenRequest({ grant_type: DEVICE_GRANT_TYPE, device_code: "nope", client_id: "gdg-cli" }),
      vi.fn(),
    );
    expect(response?.status).toBe(400);
    expect((await response?.json()) as { error: string }).toMatchObject({ error: "expired_token" });
  });

  it("returns authorization_pending while the row is pending", async () => {
    const { env } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const { device_code: deviceCode } = (await authResponse.json()) as { device_code: string };

    const response = await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      vi.fn(),
    );
    expect(response?.status).toBe(400);
    expect((await response?.json()) as { error: string }).toMatchObject({
      error: "authorization_pending",
    });
  });

  it("returns expired_token and deletes the row when polled after expiresAt", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const { device_code: deviceCode } = (await authResponse.json()) as { device_code: string };
    const row = deviceCodes[0] as DeviceRow;
    row.expiresAt = new Date(Date.now() - 1000).toISOString();

    const response = await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      vi.fn(),
    );
    expect(response?.status).toBe(400);
    expect((await response?.json()) as { error: string }).toMatchObject({ error: "expired_token" });
    expect(deviceCodes).toHaveLength(0);
  });

  it("returns slow_down when polled faster than the interval", async () => {
    const { env } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const { device_code: deviceCode } = (await authResponse.json()) as { device_code: string };

    await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      vi.fn(),
    );
    const response = await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      vi.fn(),
    );
    expect(response?.status).toBe(400);
    expect((await response?.json()) as { error: string }).toMatchObject({ error: "slow_down" });
  });

  it("returns access_denied and deletes the row once denied", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const { device_code: deviceCode } = (await authResponse.json()) as { device_code: string };
    const id = deviceCodes[0]?.id as string;

    await denyDeviceCode(env, id);
    const response = await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      vi.fn(),
    );
    expect(response?.status).toBe(400);
    expect((await response?.json()) as { error: string }).toMatchObject({ error: "access_denied" });
    expect(deviceCodes).toHaveLength(0);
  });

  it("exchanges the stored authorization code for tokens on poll and consumes it once", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const { device_code: deviceCode } = (await authResponse.json()) as { device_code: string };
    const row = deviceCodes[0] as DeviceRow;
    row.status = "completed";
    row.userId = "user-1";
    row.authorizationCode = "auth-code-xyz";

    const tokenJson = JSON.stringify({
      access_token: "at",
      refresh_token: "rt",
      token_type: "Bearer",
    });
    const runAuthHandler = vi.fn().mockResolvedValue(new Response(tokenJson, { status: 200 }));

    const first = await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      runAuthHandler,
    );
    expect(first?.status).toBe(200);
    expect(await first?.json()).toMatchObject({ access_token: "at", refresh_token: "rt" });
    expect(deviceCodes).toHaveLength(0);

    expect(runAuthHandler).toHaveBeenCalledTimes(1);
    const [, exchangeRequest] = runAuthHandler.mock.calls[0] as [Env, Request];
    expect(new URL(exchangeRequest.url).pathname).toBe("/api/auth/oauth2/token");
    const exchangeBody = new URLSearchParams(await exchangeRequest.text());
    expect(exchangeBody.get("code")).toBe("auth-code-xyz");
    expect(exchangeBody.get("grant_type")).toBe("authorization_code");
    expect(exchangeBody.get("redirect_uri")).toBe("http://127.0.0.1:8787/callback");

    const second = await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      vi.fn(),
    );
    expect(second?.status).toBe(400);
    expect((await second?.json()) as { error: string }).toMatchObject({ error: "expired_token" });
  });

  it("returns server_error when the token exchange fails, without leaving a claimable row", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const { device_code: deviceCode } = (await authResponse.json()) as { device_code: string };
    const row = deviceCodes[0] as DeviceRow;
    row.status = "completed";
    row.userId = "user-1";
    row.authorizationCode = "auth-code-xyz";

    const runAuthHandler = vi.fn().mockResolvedValue(new Response("nope", { status: 400 }));
    const response = await handleDeviceTokenGrant(
      env,
      tokenRequest({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: "gdg-cli",
      }),
      runAuthHandler,
    );
    expect(response?.status).toBe(500);
    expect((await response?.json()) as { error: string }).toMatchObject({ error: "server_error" });
    expect(deviceCodes).toHaveLength(0);
  });
});

describe("findPendingDeviceCodeByUserCode", () => {
  it("finds a pending row by user code regardless of dashes/case", async () => {
    const { env } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const { user_code: userCode } = (await authResponse.json()) as { user_code: string };

    const found = await findPendingDeviceCodeByUserCode(
      env,
      userCode.toLowerCase().replace("-", ""),
    );
    expect(found).not.toBeNull();
    expect(found?.clientId).toBe("gdg-cli");
    expect(found?.clientName).toBe("GDG Japan CLI");
  });

  it("returns null for an unknown code", async () => {
    const { env } = createFakeEnv();
    expect(await findPendingDeviceCodeByUserCode(env, "ZZZZ-ZZZZ")).toBeNull();
  });
});

describe("approveDeviceCode", () => {
  beforeEach(() => vi.useRealTimers());

  it("bridges through the authorization_code grant and stores only the one-time code", async () => {
    const { env, deviceCodes } = createFakeEnv();
    const authResponse = await handleDeviceAuthorizationRequest(
      env,
      deviceAuthRequest({ client_id: "gdg-cli" }),
    );
    const id = deviceCodes[0]?.id as string;

    const runAuthHandler = vi.fn().mockResolvedValueOnce(
      Response.json({
        redirect: true,
        url: "http://127.0.0.1:8787/callback?code=abc123&state=xyz",
      }),
    );

    const approved = await approveDeviceCode(
      env,
      new Request("https://accounts.example/device", { headers: { cookie: "session=abc" } }),
      id,
      "user-1",
      runAuthHandler,
    );

    expect(approved).toBe(true);
    // Only the authorize step runs here; the token exchange happens on the
    // CLI's next poll (handleDeviceTokenGrant), never during approve.
    expect(runAuthHandler).toHaveBeenCalledTimes(1);
    const [, authorizeRequest] = runAuthHandler.mock.calls[0] as [Env, Request];
    expect(authorizeRequest.headers.get("cookie")).toBe("session=abc");
    expect(new URL(authorizeRequest.url).pathname).toBe("/api/auth/oauth2/authorize");

    expect(deviceCodes[0]?.status).toBe("completed");
    expect(deviceCodes[0]?.userId).toBe("user-1");
    expect(deviceCodes[0]?.authorizationCode).toBe("abc123");
    void authResponse;
  });

  it("leaves the row pending if the authorize bridge fails", async () => {
    const { env, deviceCodes } = createFakeEnv();
    await handleDeviceAuthorizationRequest(env, deviceAuthRequest({ client_id: "gdg-cli" }));
    const id = deviceCodes[0]?.id as string;

    const runAuthHandler = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const approved = await approveDeviceCode(
      env,
      new Request("https://accounts.example/device"),
      id,
      "user-1",
      runAuthHandler,
    );
    expect(approved).toBe(false);
    expect(deviceCodes[0]?.status).toBe("pending");
  });

  it("leaves the row pending if the authorize response body is not JSON", async () => {
    const { env, deviceCodes } = createFakeEnv();
    await handleDeviceAuthorizationRequest(env, deviceAuthRequest({ client_id: "gdg-cli" }));
    const id = deviceCodes[0]?.id as string;

    const runAuthHandler = vi
      .fn()
      .mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));
    const approved = await approveDeviceCode(
      env,
      new Request("https://accounts.example/device"),
      id,
      "user-1",
      runAuthHandler,
    );
    expect(approved).toBe(false);
    expect(deviceCodes[0]?.status).toBe("pending");
  });

  it("returns false when the client has no redirect URIs configured", async () => {
    const noRedirectClient: ClientRow = {
      ...GDG_CLI,
      clientId: "no-redirect",
      redirectUris: JSON.stringify([]),
    };
    const { env, deviceCodes } = createFakeEnv([noRedirectClient]);
    await handleDeviceAuthorizationRequest(env, deviceAuthRequest({ client_id: "no-redirect" }));
    const id = deviceCodes[0]?.id as string;

    const runAuthHandler = vi.fn();
    const approved = await approveDeviceCode(
      env,
      new Request("https://accounts.example/device"),
      id,
      "user-1",
      runAuthHandler,
    );
    expect(approved).toBe(false);
    expect(runAuthHandler).not.toHaveBeenCalled();
    expect(deviceCodes[0]?.status).toBe("pending");
  });

  it("returns false for an already-resolved or unknown id", async () => {
    const { env } = createFakeEnv();
    const runAuthHandler = vi.fn();
    const approved = await approveDeviceCode(
      env,
      new Request("https://accounts.example/device"),
      "missing-id",
      "user-1",
      runAuthHandler,
    );
    expect(approved).toBe(false);
    expect(runAuthHandler).not.toHaveBeenCalled();
  });
});
