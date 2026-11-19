import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import { cleanupCanceledMeeting } from "./cleanup-meeting.server";
import type { MeetingRecord } from "./meeting";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(8)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

const CANCELED_MEETING: MeetingRecord = {
  id: "mtg-cleanup-1",
  hostChapterId: 1,
  title: "取り消し済み会議",
  description: "",
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "OPEN",
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
  spaceName: "spaces/cleanup-1",
  meetingUri: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
  calendarEventId: "evt-cleanup-1",
  calendarHtmlLink: null,
  status: "canceled",
  lastError: null,
  createdByUserId: "u-1",
  createdByEmail: "creator@example.com",
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  canceledAt: "2026-11-19T08:00:00.000Z",
};

async function createEnvFixture(meeting: MeetingRecord | null) {
  let currentMeeting = meeting ? { ...meeting } : null;
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-cleanup-refresh",
  );
  const connection: GoogleConnectionRow = {
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
            return connection as T;
          }
          if (sql.includes("FROM meetings WHERE id = ?")) {
            if (!currentMeeting) return null;
            return {
              id: currentMeeting.id,
              host_chapter_id: currentMeeting.hostChapterId,
              title: currentMeeting.title,
              description: currentMeeting.description,
              start_at: currentMeeting.startAt,
              end_at: currentMeeting.endAt,
              time_zone: currentMeeting.timeZone,
              access_type: currentMeeting.accessType,
              auto_transcription: currentMeeting.autoTranscription ? 1 : 0,
              auto_smart_notes: currentMeeting.autoSmartNotes ? 1 : 0,
              auto_recording: currentMeeting.autoRecording ? 1 : 0,
              space_name: currentMeeting.spaceName,
              meeting_uri: currentMeeting.meetingUri,
              meeting_code: currentMeeting.meetingCode,
              calendar_event_id: currentMeeting.calendarEventId,
              calendar_html_link: currentMeeting.calendarHtmlLink,
              status: currentMeeting.status,
              last_error: currentMeeting.lastError,
              created_by_user_id: currentMeeting.createdByUserId,
              created_by_email: currentMeeting.createdByEmail,
              created_at: currentMeeting.createdAt,
              updated_at: currentMeeting.updatedAt,
              canceled_at: currentMeeting.canceledAt,
            } as T;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async run() {
          if (sql.includes("SET last_error = ?")) {
            const [lastError, updatedAt] = args as [string | null, string];
            if (currentMeeting) {
              currentMeeting = { ...currentMeeting, lastError, updatedAt };
            }
            return { success: true, meta: {} };
          }
          throw new Error(`未対応の run(): ${sql}`);
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
  } as unknown as Env;

  return { env, getMeeting: () => currentMeeting };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("cleanupCanceledMeeting", () => {
  it("オーナー以外の全メンバーを削除し、RESTRICTED 化と endActiveConference を実行する（Drive API は呼ばない）", async () => {
    const { env } = await createEnvFixture(CANCELED_MEETING);
    const ops: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.cleanup-token", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/spaces/cleanup-1/members" && method === "GET") {
        ops.push("LIST_MEMBERS");
        return Response.json({
          members: [
            { name: "spaces/cleanup-1/members/host", email: HOST_EMAIL, role: "COHOST" },
            { name: "spaces/cleanup-1/members/m1", email: "cohost@example.com", role: "COHOST" },
            { name: "spaces/cleanup-1/members/m2", email: "guest@example.com" },
          ],
        });
      }
      if (
        url.startsWith("https://meet.googleapis.com/v2/spaces/cleanup-1/members/") &&
        method === "DELETE"
      ) {
        ops.push(
          `DELETE:${decodeURIComponent(url.replace("https://meet.googleapis.com/v2/", ""))}`,
        );
        return new Response(null, { status: 204 });
      }
      if (
        url === "https://meet.googleapis.com/v2/spaces/cleanup-1?updateMask=config.accessType" &&
        method === "PATCH"
      ) {
        const body = JSON.parse(String(init?.body)) as { config?: { accessType?: string } };
        ops.push(`PATCH:${body.config?.accessType}`);
        return Response.json({
          name: "spaces/cleanup-1",
          meetingUri: CANCELED_MEETING.meetingUri,
          meetingCode: CANCELED_MEETING.meetingCode,
          config: { accessType: "RESTRICTED", moderation: "ON" },
        });
      }
      if (
        url === "https://meet.googleapis.com/v2/spaces/cleanup-1:endActiveConference" &&
        method === "POST"
      ) {
        ops.push("END_ACTIVE_CONFERENCE");
        return Response.json({});
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await cleanupCanceledMeeting(env, "mtg-cleanup-1", { fetchFn: fetchMock });

    expect(ops).toEqual([
      "LIST_MEMBERS",
      "DELETE:spaces/cleanup-1/members/m1",
      "DELETE:spaces/cleanup-1/members/m2",
      "PATCH:RESTRICTED",
      "END_ACTIVE_CONFERENCE",
    ]);
  });

  it("進行中会議が存在せず endActiveConference が 404 または FAILED_PRECONDITION を返しても正常終了する", async () => {
    const cases = [
      { status: 404, apiStatus: "NOT_FOUND", message: "No active conference" },
      { status: 400, apiStatus: "FAILED_PRECONDITION", message: "No active conference" },
    ];

    for (const errCase of cases) {
      resetGoogleAccessTokenCache();
      const { env, getMeeting } = await createEnvFixture(CANCELED_MEETING);
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "ya29.cleanup-token", expires_in: 3600 });
        }
        if (method === "GET") {
          return Response.json({ members: [] });
        }
        if (method === "PATCH") {
          return Response.json({ name: "spaces/cleanup-1" });
        }
        if (url.endsWith(":endActiveConference")) {
          return Response.json(
            { error: { status: errCase.apiStatus, message: errCase.message } },
            { status: errCase.status },
          );
        }
        throw new Error(`想定外の fetch: ${method} ${url}`);
      }) as unknown as typeof fetch;

      await expect(
        cleanupCanceledMeeting(env, "mtg-cleanup-1", { fetchFn: fetchMock }),
      ).resolves.toBeUndefined();
      expect(getMeeting()?.lastError).toBeNull();
    }
  });

  it("429 エラー発生時は last_error を記録して GoogleApiError を再スローする", async () => {
    const { env, getMeeting } = await createEnvFixture(CANCELED_MEETING);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.cleanup-token", expires_in: 3600 });
      }
      if (method === "GET") {
        return Response.json({
          members: [{ name: "spaces/cleanup-1/members/m1", email: "guest@example.com" }],
        });
      }
      return Response.json(
        { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } },
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    await expect(
      cleanupCanceledMeeting(env, "mtg-cleanup-1", { fetchFn: fetchMock }),
    ).rejects.toThrow(GoogleApiError);
    expect(getMeeting()?.lastError).toContain("429");
  });

  it("未取り消し（active）や spaceName 未設定の会議には何もしない", async () => {
    const { env: activeEnv } = await createEnvFixture({ ...CANCELED_MEETING, status: "active" });
    const { env: noSpaceEnv } = await createEnvFixture({ ...CANCELED_MEETING, spaceName: null });
    const fetchMock = vi.fn() as unknown as typeof fetch;

    await cleanupCanceledMeeting(activeEnv, "mtg-cleanup-1", { fetchFn: fetchMock });
    await cleanupCanceledMeeting(noSpaceEnv, "mtg-cleanup-1", { fetchFn: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
