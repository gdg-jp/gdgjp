import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import { cancelMeeting } from "./cancel-meeting.server";
import type { MeetingRecord } from "./meeting";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(6)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

const ACTIVE_MEETING: MeetingRecord = {
  id: "mtg-cancel-1",
  hostChapterId: 1,
  title: "取り消し対象会議",
  description: "",
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "OPEN",
  spaceName: "spaces/cancel-1",
  meetingUri: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
  calendarEventId: "evt-cancel-1",
  calendarHtmlLink: "https://calendar.google.com/event?eid=1",
  status: "active",
  lastError: null,
  createdByUserId: "u-1",
  createdByEmail: "creator@example.com",
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  canceledAt: null,
};

async function createEnvFixture(connected = true) {
  let connection: GoogleConnectionRow | null = null;
  if (connected) {
    const encrypted = await encryptRefreshToken(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
      GOOGLE_CONNECTION_AAD,
      "1//0g-cancel-refresh",
    );
    connection = {
      id: 1,
      email: HOST_EMAIL,
      google_user_id: "110111222333",
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_nonce: encrypted.nonce,
      encryption_key_version: encrypted.keyVersion,
      scope: "https://www.googleapis.com/auth/calendar.events",
      connected_by_user_id: "admin-1",
      connected_at: "2026-11-19T00:00:00.000Z",
      updated_at: "2026-11-19T00:00:00.000Z",
      status: "connected",
      last_error: null,
    };
  }

  let canceledUpdate: { canceledAt: string; updatedAt: string; id: string } | null = null;
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
          throw new Error(`未対応の first(): ${sql}`);
        },
        async run() {
          if (sql.includes("SET status = 'canceled'")) {
            canceledUpdate = {
              canceledAt: String(args[0]),
              updatedAt: String(args[1]),
              id: String(args[2]),
            };
            return { success: true, meta: {} };
          }
          if (sql.includes("SET last_error = ?")) {
            return { success: true, meta: {} };
          }
          throw new Error(`未対応の run(): ${sql}`);
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  const queueSend = vi.fn().mockResolvedValue(undefined);
  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
    MEET_JOBS: { send: queueSend },
  } as unknown as Env;

  return { env, queueSend, getCanceledUpdate: () => canceledUpdate };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("cancelMeeting", () => {
  it("calendar.deleteEvent(sendUpdates=all) を呼び、D1 を canceled に更新して cleanup_meeting を投入する", async () => {
    const { env, queueSend, getCanceledUpdate } = await createEnvFixture();
    const deleteCalls: Array<{ url: string; method: string }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.cancel-token", expires_in: 3600 });
      }
      deleteCalls.push({ url, method });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const result = await cancelMeeting(env, ACTIVE_MEETING, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-19T08:00:00.000Z"),
    });

    expect(result).toEqual({ ok: true, meetingId: "mtg-cancel-1" });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].method).toBe("DELETE");
    const parsedUrl = new URL(deleteCalls[0].url);
    expect(parsedUrl.pathname).toBe("/calendar/v3/calendars/primary/events/evt-cancel-1");
    expect(parsedUrl.searchParams.get("sendUpdates")).toBe("all");
    expect(getCanceledUpdate()).toEqual({
      id: "mtg-cancel-1",
      canceledAt: "2026-11-19T08:00:00.000Z",
      updatedAt: "2026-11-19T08:00:00.000Z",
    });
    expect(queueSend).toHaveBeenCalledWith({
      type: "cleanup_meeting",
      meetingId: "mtg-cancel-1",
    });
  });

  it("Google Calendar 側で既に削除済み（404 / 410）の場合は冪等に成功扱いとする", async () => {
    for (const status of [404, 410]) {
      resetGoogleAccessTokenCache();
      const { env, queueSend, getCanceledUpdate } = await createEnvFixture();
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "ya29.cancel-token", expires_in: 3600 });
        }
        return Response.json(
          { error: { status: "NOT_FOUND", message: "Resource has been deleted" } },
          { status },
        );
      }) as unknown as typeof fetch;

      const result = await cancelMeeting(env, ACTIVE_MEETING, {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T08:00:00.000Z"),
      });

      expect(result).toEqual({ ok: true, meetingId: "mtg-cancel-1" });
      expect(getCanceledUpdate()?.id).toBe("mtg-cancel-1");
      expect(queueSend).toHaveBeenCalledWith({
        type: "cleanup_meeting",
        meetingId: "mtg-cancel-1",
      });
    }
  });

  it("すでに canceled の会議は 409 で拒否し Google API も Queue も呼ばない", async () => {
    const { env, queueSend, getCanceledUpdate } = await createEnvFixture();
    const fetchMock = vi.fn() as unknown as typeof fetch;

    const result = await cancelMeeting(
      env,
      { ...ACTIVE_MEETING, status: "canceled" },
      { fetchFn: fetchMock },
    );

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCanceledUpdate()).toBeNull();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("Calendar API が 500 を返した場合はエラーを返し D1 を canceled にしない", async () => {
    const { env, queueSend, getCanceledUpdate } = await createEnvFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.cancel-token", expires_in: 3600 });
      }
      return Response.json(
        { error: { status: "INTERNAL", message: "Calendar error" } },
        { status: 500 },
      );
    }) as unknown as typeof fetch;

    const result = await cancelMeeting(env, ACTIVE_MEETING, { fetchFn: fetchMock });

    expect(result.ok).toBe(false);
    expect(getCanceledUpdate()).toBeNull();
    expect(queueSend).not.toHaveBeenCalled();
  });
});
