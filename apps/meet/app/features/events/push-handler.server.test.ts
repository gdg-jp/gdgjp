import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import type { MeetingRecord } from "~/features/meetings/meeting";
import { handleRawPubsubPushBody, processPubsubEnvelope } from "./push-handler.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(4)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";
const TOPIC = "projects/gdgs-meet/topics/meet-events";

const MANAGED_MEETING: MeetingRecord = {
  id: "mtg-1",
  hostChapterId: 1,
  title: "定例会議",
  description: "",
  startAt: "2026-11-19T10:00:00.000Z",
  endAt: "2026-11-19T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "RESTRICTED",
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
  spaceName: "spaces/managed-1",
  meetingUri: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
  calendarEventId: "evt-1",
  calendarHtmlLink: null,
  status: "active",
  lastError: null,
  createdByUserId: "u-1",
  createdByEmail: "organizer@example.com",
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  canceledAt: null,
};

function encodeData(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

function createFakePushDb(connection: GoogleConnectionRow, meetings: MeetingRecord[]) {
  const processedEvents = new Map<string, string>();
  const conferenceRecords = new Map<
    string,
    { name: string; meeting_id: string; start_time: string | null; end_time: string | null }
  >();

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
          if (sql.includes("FROM conference_records WHERE name = ?")) {
            return (conferenceRecords.get(String(args[0])) ?? null) as T | null;
          }
          if (sql.includes("FROM meetings WHERE space_name = ?")) {
            const m = meetings.find((item) => item.spaceName === String(args[0]));
            if (!m) return null;
            return {
              id: m.id,
              host_chapter_id: m.hostChapterId,
              title: m.title,
              description: m.description,
              start_at: m.startAt,
              end_at: m.endAt,
              time_zone: m.timeZone,
              access_type: m.accessType,
              auto_transcription: m.autoTranscription ? 1 : 0,
              auto_smart_notes: m.autoSmartNotes ? 1 : 0,
              auto_recording: m.autoRecording ? 1 : 0,
              space_name: m.spaceName,
              meeting_uri: m.meetingUri,
              meeting_code: m.meetingCode,
              calendar_event_id: m.calendarEventId,
              calendar_html_link: m.calendarHtmlLink,
              status: m.status,
              last_error: m.lastError,
              created_by_user_id: m.createdByUserId,
              created_by_email: m.createdByEmail,
              created_at: m.createdAt,
              updated_at: m.updatedAt,
              canceled_at: m.canceledAt,
            } as T;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO processed_events")) {
            const [key, receivedAt] = args as [string, string];
            if (processedEvents.has(key)) {
              return { success: true, meta: { changes: 0 } };
            }
            processedEvents.set(key, receivedAt);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM processed_events WHERE dedupe_key = ?")) {
            const existed = processedEvents.delete(String(args[0]));
            return { success: true, meta: { changes: existed ? 1 : 0 } };
          }
          if (sql.includes("INSERT INTO conference_records")) {
            const [name, meetingId, startTime, endTime] = args as [
              string,
              string,
              string | null,
              string | null,
            ];
            const prev = conferenceRecords.get(name);
            conferenceRecords.set(name, {
              name,
              meeting_id: meetingId,
              start_time: startTime ?? prev?.start_time ?? null,
              end_time: endTime ?? prev?.end_time ?? null,
            });
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
    processedEvents,
    conferenceRecords,
  };
}

async function createEnvFixture(meetings: MeetingRecord[] = [MANAGED_MEETING]) {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-push-refresh",
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
  const dbFixture = createFakePushDb(connection, meetings);
  const queueSend = vi.fn().mockResolvedValue(undefined);
  const env = {
    DB: dbFixture.db,
    MEET_JOBS: { send: queueSend },
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
    GOOGLE_PUBSUB_TOPIC: TOPIC,
  } as unknown as Env;
  return { env, queueSend, ...dbFixture };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("processPubsubEnvelope", () => {
  it("順不同配信（fileGenerated が conference.ended より先着）でも space を引いて処理し、重複配信の 2 回目はスキップする", async () => {
    const { env, queueSend, conferenceRecords } = await createEnvFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.push", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/conferenceRecords/conf-1") {
        return Response.json({
          name: "conferenceRecords/conf-1",
          space: "spaces/managed-1",
          startTime: "2026-11-19T10:00:00Z",
        });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    const envelope = {
      message: {
        attributes: {
          "ce-type": "google.workspace.meet.recording.v2.fileGenerated",
        },
        data: encodeData({
          recording: { name: "conferenceRecords/conf-1/recordings/rec-1" },
        }),
      },
    };

    // 1 回目: conference.ended 未着でも conferenceRecords.get から会議を特定しジョブ投入する。
    const res1 = await processPubsubEnvelope(env, envelope, { fetchFn: fetchMock });
    expect(res1).toEqual({ status: 204, action: "enqueued" });
    expect(conferenceRecords.get("conferenceRecords/conf-1")?.meeting_id).toBe("mtg-1");
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(queueSend).toHaveBeenCalledWith({
      type: "process_artifact",
      meetingId: "mtg-1",
      kind: "recording",
      conferenceRecord: "conferenceRecords/conf-1",
      resourceName: "conferenceRecords/conf-1/recordings/rec-1",
    });

    // 2 回目（重複配信）: processed_events により即 204 でスキップされ、ジョブは増えない。
    const res2 = await processPubsubEnvelope(env, envelope, { fetchFn: fetchMock });
    expect(res2).toEqual({ status: 204, action: "duplicate" });
    expect(queueSend).toHaveBeenCalledTimes(1);
  });

  it("D1 meetings.space_name に存在しないアプリ外スペースの通知は無視し、保存もジョブ投入もしない", async () => {
    const { env, queueSend, conferenceRecords } = await createEnvFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.push", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/conferenceRecords/conf-external") {
        return Response.json({
          name: "conferenceRecords/conf-external",
          space: "spaces/not-in-db",
        });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await processPubsubEnvelope(
      env,
      {
        message: {
          attributes: { "ce-type": "google.workspace.meet.transcript.v2.fileGenerated" },
          data: encodeData({
            transcript: { name: "conferenceRecords/conf-external/transcripts/tr-1" },
          }),
        },
      },
      { fetchFn: fetchMock },
    );

    expect(res).toEqual({ status: 204, action: "unmanaged_space" });
    expect(conferenceRecords.size).toBe(0);
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("破損 JSON やデコード不能な message.data は警告ログを残して 204 で ack する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, queueSend } = await createEnvFixture();

    const badJson = await handleRawPubsubPushBody(env, "{broken json");
    expect(badJson).toEqual({ status: 204, action: "invalid_envelope" });

    const badBase64 = await processPubsubEnvelope(env, {
      message: {
        attributes: { "ce-type": "google.workspace.meet.recording.v2.fileGenerated" },
        data: "!!!not-base64!!!",
      },
    });
    expect(badBase64).toEqual({ status: 204, action: "invalid_data" });
    expect(queueSend).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("MEET_JOBS.send が失敗したら processed_events を巻き戻して 500 を返し、再送で処理できる", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, queueSend, processedEvents } = await createEnvFixture();
    queueSend.mockRejectedValueOnce(new Error("Queue transient failure"));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.push", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/conferenceRecords/conf-retry") {
        return Response.json({
          name: "conferenceRecords/conf-retry",
          space: "spaces/managed-1",
        });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    const envelope = {
      message: {
        attributes: { "ce-type": "google.workspace.meet.smartNote.v2.fileGenerated" },
        data: encodeData({
          smartNote: { name: "conferenceRecords/conf-retry/smartNotes/sn-1" },
        }),
      },
    };

    const res1 = await processPubsubEnvelope(env, envelope, { fetchFn: fetchMock });
    expect(res1).toEqual({ status: 500, action: "error" });
    expect(processedEvents.size).toBe(0);

    // Pub/Sub からの再送時は重複扱いにならず正常に enqueue される。
    const res2 = await processPubsubEnvelope(env, envelope, { fetchFn: fetchMock });
    expect(res2).toEqual({ status: 204, action: "enqueued" });
    expect(queueSend).toHaveBeenCalledTimes(2);
    expect(processedEvents.size).toBe(1);
    errorSpy.mockRestore();
  });
});
