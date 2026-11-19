import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import {
  type GoogleSubscriptionRecord,
  WORKSPACE_EVENT_TYPES,
  buildUserSubscriptionFilter,
  ensureSubscription,
  handleExpirationReminder,
  handleSubscriptionExpired,
  handleSubscriptionSuspended,
} from "./subscription.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(3)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";
const TOPIC = "projects/gdgs-meet/topics/meet-events";
const TARGET_RESOURCE = "//cloudidentity.googleapis.com/users/110111222333";

function createFakeSubscriptionDb(
  connection: GoogleConnectionRow | null,
  initialSub: GoogleSubscriptionRecord | null,
) {
  let currentSub = initialSub ? { ...initialSub } : null;

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes("FROM google_connection WHERE id = ?")) {
            return connection as T | null;
          }
          if (sql.includes("FROM google_subscription WHERE id = ?")) {
            if (!currentSub) return null;
            return {
              id: 1,
              name: currentSub.name,
              state: currentSub.state,
              expire_time: currentSub.expireTime,
              updated_at: currentSub.updatedAt,
              last_error: currentSub.lastError,
            } as T;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT INTO google_subscription")) {
            const [, name, state, expireTime, updatedAt, lastError] = args as [
              number,
              string,
              string,
              string,
              string,
              string | null,
            ];
            currentSub = { name, state, expireTime, updatedAt, lastError };
            return { success: true, meta: { changes: 1 } };
          }
          throw new Error(`未対応の run(): ${sql}`);
        },
      };
      return stmt;
    },
  };

  return {
    db: db as unknown as D1Database,
    getSubscription: () => currentSub,
  };
}

async function createEnvFixture(initialSub: GoogleSubscriptionRecord | null, connected = true) {
  let connection: GoogleConnectionRow | null = null;
  if (connected) {
    const encrypted = await encryptRefreshToken(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
      GOOGLE_CONNECTION_AAD,
      "1//0g-sub-refresh",
    );
    connection = {
      id: 1,
      email: HOST_EMAIL,
      google_user_id: "110111222333",
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_nonce: encrypted.nonce,
      encryption_key_version: encrypted.keyVersion,
      scope: "https://www.googleapis.com/auth/meetings.space.created",
      connected_by_user_id: "admin-1",
      connected_at: "2026-11-19T00:00:00.000Z",
      updated_at: "2026-11-19T00:00:00.000Z",
      status: "connected",
      last_error: null,
    };
  }
  const dbFixture = createFakeSubscriptionDb(connection, initialSub);
  const env = {
    DB: dbFixture.db,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
    GOOGLE_PUBSUB_TOPIC: TOPIC,
  } as unknown as Env;
  return { env, ...dbFixture };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("ensureSubscription & ライフサイクル通知", () => {
  it("期限が残 2 日以上あり ACTIVE な購読は API を呼ばず維持する", async () => {
    const { env } = await createEnvFixture({
      name: "subscriptions/sub-1",
      state: "ACTIVE",
      expireTime: "2026-11-25T00:00:00.000Z",
      updatedAt: "2026-11-19T00:00:00.000Z",
      lastError: null,
    });
    const fetchMock = vi.fn() as unknown as typeof fetch;

    const result = await ensureSubscription(env, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-20T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ ok: true, action: "kept" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("期限が残 2 日未満の購読は patchSubscriptionTtl(ttl: '0s') で延長する", async () => {
    const { env, getSubscription } = await createEnvFixture({
      name: "subscriptions/sub-1",
      state: "ACTIVE",
      expireTime: "2026-11-21T12:00:00.000Z",
      updatedAt: "2026-11-19T00:00:00.000Z",
      lastError: null,
    });

    let patchBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sub", expires_in: 3600 });
      }
      if (url.includes("/v1/subscriptions/sub-1") && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return Response.json({
          name: "operations/op-1",
          done: true,
          response: {
            name: "subscriptions/sub-1",
            targetResource: TARGET_RESOURCE,
            eventTypes: [...WORKSPACE_EVENT_TYPES],
            notificationEndpoint: { pubsubTopic: TOPIC },
            state: "ACTIVE",
            expireTime: "2026-11-27T00:00:00.000Z",
          },
        });
      }
      throw new Error(`想定外の fetch: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await ensureSubscription(env, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-20T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ ok: true, action: "extended" });
    expect(patchBody).toEqual({ ttl: "0s" });
    expect(getSubscription()?.expireTime).toBe("2026-11-27T00:00:00.000Z");
  });

  it("延長が期限切れ等で失敗した場合は createSubscription で作り直す", async () => {
    const { env, getSubscription } = await createEnvFixture({
      name: "subscriptions/expired-sub",
      state: "ACTIVE",
      expireTime: "2026-11-19T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
      lastError: null,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sub", expires_in: 3600 });
      }
      if (url.includes("/v1/subscriptions/expired-sub") && init?.method === "PATCH") {
        return Response.json(
          { error: { code: 404, status: "NOT_FOUND", message: "Subscription not found" } },
          { status: 404 },
        );
      }
      if (
        url === "https://workspaceevents.googleapis.com/v1/subscriptions" &&
        init?.method === "POST"
      ) {
        return Response.json({
          name: "operations/op-create",
          done: true,
          response: {
            name: "subscriptions/sub-new",
            targetResource: TARGET_RESOURCE,
            eventTypes: [...WORKSPACE_EVENT_TYPES],
            notificationEndpoint: { pubsubTopic: TOPIC },
            state: "ACTIVE",
            expireTime: "2026-11-27T00:00:00.000Z",
          },
        });
      }
      throw new Error(`想定外の fetch: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await ensureSubscription(env, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-20T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ ok: true, action: "created" });
    expect(getSubscription()?.name).toBe("subscriptions/sub-new");
  });

  it("createSubscription が 409 ALREADY_EXISTS を返したとき、topic と 4 型が一致する既存購読を採用して TTL を延長する（フィルタ文字列を固定）", async () => {
    const { env, getSubscription } = await createEnvFixture(null);
    let capturedListFilter: string | null = null;
    let patchedName: string | null = null;
    let deleteCalled = false;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sub", expires_in: 3600 });
      }
      if (url === "https://workspaceevents.googleapis.com/v1/subscriptions" && method === "POST") {
        return Response.json(
          {
            error: { code: 409, status: "ALREADY_EXISTS", message: "Subscription already exists" },
          },
          { status: 409 },
        );
      }
      if (
        url.startsWith("https://workspaceevents.googleapis.com/v1/subscriptions?") &&
        method === "GET"
      ) {
        capturedListFilter = new URL(url).searchParams.get("filter");
        return Response.json({
          subscriptions: [
            {
              name: "subscriptions/existing-matching",
              targetResource: TARGET_RESOURCE,
              eventTypes: [...WORKSPACE_EVENT_TYPES].reverse(),
              notificationEndpoint: { pubsubTopic: TOPIC },
              state: "ACTIVE",
              expireTime: "2026-11-22T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/v1/subscriptions/existing-matching") && method === "PATCH") {
        patchedName = "subscriptions/existing-matching";
        return Response.json({
          name: "operations/op-extend",
          done: true,
          response: {
            name: "subscriptions/existing-matching",
            targetResource: TARGET_RESOURCE,
            eventTypes: [...WORKSPACE_EVENT_TYPES],
            notificationEndpoint: { pubsubTopic: TOPIC },
            state: "ACTIVE",
            expireTime: "2026-11-27T00:00:00.000Z",
          },
        });
      }
      if (method === "DELETE") {
        deleteCalled = true;
        return Response.json({ name: "operations/op-del", done: true });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await ensureSubscription(env, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-20T00:00:00.000Z"),
    });

    expect(capturedListFilter).toBe(
      'event_types:"google.workspace.meet.conference.v2.ended" AND target_resource="//cloudidentity.googleapis.com/users/110111222333"',
    );
    expect(capturedListFilter).toBe(buildUserSubscriptionFilter(TARGET_RESOURCE));
    expect(deleteCalled).toBe(false);
    expect(patchedName).toBe("subscriptions/existing-matching");
    expect(result).toMatchObject({ ok: true, action: "adopted_and_extended" });
    expect(getSubscription()).toMatchObject({
      name: "subscriptions/existing-matching",
      expireTime: "2026-11-27T00:00:00.000Z",
      lastError: null,
    });
  });

  it("createSubscription が 409 ALREADY_EXISTS を返したとき、topic または eventTypes が不一致なら既存購読を削除して作り直す", async () => {
    const { env, getSubscription } = await createEnvFixture(null);
    let createCalls = 0;
    let capturedListFilter: string | null = null;
    const ops: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sub", expires_in: 3600 });
      }
      if (url === "https://workspaceevents.googleapis.com/v1/subscriptions" && method === "POST") {
        createCalls += 1;
        ops.push(`CREATE#${createCalls}`);
        if (createCalls === 1) {
          return Response.json(
            { error: { code: 409, status: "ALREADY_EXISTS", message: "Already exists" } },
            { status: 409 },
          );
        }
        return Response.json({
          name: "operations/op-recreate",
          done: true,
          response: {
            name: "subscriptions/recreated-1",
            targetResource: TARGET_RESOURCE,
            eventTypes: [...WORKSPACE_EVENT_TYPES],
            notificationEndpoint: { pubsubTopic: TOPIC },
            state: "ACTIVE",
            expireTime: "2026-11-27T00:00:00.000Z",
          },
        });
      }
      if (
        url.startsWith("https://workspaceevents.googleapis.com/v1/subscriptions?") &&
        method === "GET"
      ) {
        capturedListFilter = new URL(url).searchParams.get("filter");
        ops.push("LIST");
        return Response.json({
          subscriptions: [
            {
              name: "subscriptions/old-poc",
              targetResource: TARGET_RESOURCE,
              // PoC の購読などイベント型が異なるケース
              eventTypes: ["google.workspace.meet.conference.v2.ended"],
              notificationEndpoint: { pubsubTopic: TOPIC },
              state: "ACTIVE",
              expireTime: "2026-11-25T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/v1/subscriptions/old-poc") && method === "DELETE") {
        ops.push("DELETE:subscriptions/old-poc");
        return Response.json({ name: "operations/op-del", done: true });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await ensureSubscription(env, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-20T00:00:00.000Z"),
    });

    expect(capturedListFilter).toBe(
      'event_types:"google.workspace.meet.conference.v2.ended" AND target_resource="//cloudidentity.googleapis.com/users/110111222333"',
    );
    expect(ops).toEqual(["CREATE#1", "LIST", "DELETE:subscriptions/old-poc", "CREATE#2"]);
    expect(result).toMatchObject({ ok: true, action: "recreated" });
    expect(getSubscription()?.name).toBe("subscriptions/recreated-1");
  });

  it("expirationReminder で即延長・expired で再作成・suspended で状態記録＋reactivate 試行する", async () => {
    const { env, getSubscription } = await createEnvFixture({
      name: "subscriptions/sub-life",
      state: "ACTIVE",
      expireTime: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-19T00:00:00.000Z",
      lastError: null,
    });

    const called: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sub", expires_in: 3600 });
      }
      if (url.includes("/v1/subscriptions/sub-life") && method === "PATCH") {
        called.push("PATCH");
        return Response.json({
          name: "operations/op-patch",
          done: true,
          response: {
            name: "subscriptions/sub-life",
            targetResource: TARGET_RESOURCE,
            eventTypes: [...WORKSPACE_EVENT_TYPES],
            notificationEndpoint: { pubsubTopic: TOPIC },
            state: "ACTIVE",
            expireTime: "2026-11-28T00:00:00.000Z",
          },
        });
      }
      if (url === "https://workspaceevents.googleapis.com/v1/subscriptions" && method === "POST") {
        called.push("CREATE");
        return Response.json({
          name: "operations/op-create",
          done: true,
          response: {
            name: "subscriptions/sub-reborn",
            targetResource: TARGET_RESOURCE,
            eventTypes: [...WORKSPACE_EVENT_TYPES],
            notificationEndpoint: { pubsubTopic: TOPIC },
            state: "ACTIVE",
            expireTime: "2026-11-29T00:00:00.000Z",
          },
        });
      }
      if (url.endsWith(":reactivate") && method === "POST") {
        called.push("REACTIVATE");
        return Response.json(
          { error: { code: 400, status: "FAILED_PRECONDITION", message: "Permission revoked" } },
          { status: 400 },
        );
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await handleExpirationReminder(env, "subscriptions/sub-life", {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-20T00:00:00.000Z"),
    });
    expect(getSubscription()?.expireTime).toBe("2026-11-28T00:00:00.000Z");

    await handleSubscriptionExpired(env, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-21T00:00:00.000Z"),
    });
    expect(getSubscription()?.name).toBe("subscriptions/sub-reborn");

    await handleSubscriptionSuspended(env, "subscriptions/sub-reborn", "USER_SCOPE_REVOKED", {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-22T00:00:00.000Z"),
    });
    expect(getSubscription()).toMatchObject({
      name: "subscriptions/sub-reborn",
      state: "SUSPENDED",
    });
    expect(getSubscription()?.lastError).toContain("Permission revoked");
    expect(called).toEqual(["PATCH", "CREATE", "REACTIVATE"]);
  });
});
