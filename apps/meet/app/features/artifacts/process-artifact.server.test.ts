import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import type { MeetingRecord } from "~/features/meetings/meeting";
import type { ArtifactKind, ArtifactRecord } from "./artifact";
import { processArtifactJob } from "./process-artifact.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(6)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

const ACTIVE_MEETING: MeetingRecord = {
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
  spaceName: "spaces/space-1",
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

function createFakeProcessDb(connection: GoogleConnectionRow, meeting: MeetingRecord | null) {
  const byDriveId = new Map<string, ArtifactRecord>();
  const transcriptStats = new Map<
    string,
    {
      transcript: string;
      conference_record: string;
      status: string;
      attempts: number;
      collected_at: string | null;
      last_error: string | null;
    }
  >();

  const toRow = (a: ArtifactRecord) => ({
    id: a.id,
    meeting_id: a.meetingId,
    conference_record: a.conferenceRecord,
    kind: a.kind,
    drive_file_id: a.driveFileId,
    title: a.title,
    mime_type: a.mimeType,
    web_view_link: a.webViewLink,
    created_at: a.createdAt,
    shared_at: a.sharedAt,
    attached_at: a.attachedAt,
    last_error: a.lastError,
    attempts: a.attempts,
  });

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
            if (!meeting) return null;
            return {
              id: meeting.id,
              host_chapter_id: meeting.hostChapterId,
              title: meeting.title,
              description: meeting.description,
              start_at: meeting.startAt,
              end_at: meeting.endAt,
              time_zone: meeting.timeZone,
              access_type: meeting.accessType,
              auto_transcription: meeting.autoTranscription ? 1 : 0,
              auto_smart_notes: meeting.autoSmartNotes ? 1 : 0,
              auto_recording: meeting.autoRecording ? 1 : 0,
              space_name: meeting.spaceName,
              meeting_uri: meeting.meetingUri,
              meeting_code: meeting.meetingCode,
              calendar_event_id: meeting.calendarEventId,
              calendar_html_link: meeting.calendarHtmlLink,
              status: meeting.status,
              last_error: meeting.lastError,
              created_by_user_id: meeting.createdByUserId,
              created_by_email: meeting.createdByEmail,
              created_at: meeting.createdAt,
              updated_at: meeting.updatedAt,
              canceled_at: meeting.canceledAt,
            } as T;
          }
          if (sql.includes("FROM artifacts WHERE drive_file_id = ?")) {
            const hit = byDriveId.get(String(args[0]));
            return (hit ? toRow(hit) : null) as T | null;
          }
          if (sql.includes("FROM conference_transcript_stats WHERE transcript = ?")) {
            return (transcriptStats.get(String(args[0])) ?? null) as T | null;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO conference_transcript_stats")) {
            const [transcript, conferenceRecord] = args as [string, string];
            if (!transcriptStats.has(transcript)) {
              transcriptStats.set(transcript, {
                transcript,
                conference_record: conferenceRecord,
                status: "pending",
                attempts: 0,
                collected_at: null,
                last_error: null,
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO artifacts")) {
            const [
              id,
              meetingId,
              conferenceRecord,
              kind,
              driveFileId,
              title,
              mimeType,
              webViewLink,
              createdAt,
            ] = args as [
              string,
              string,
              string,
              ArtifactKind,
              string,
              string,
              string,
              string,
              string,
            ];
            const prev = byDriveId.get(driveFileId);
            if (prev) {
              byDriveId.set(driveFileId, { ...prev, title, webViewLink });
            } else {
              byDriveId.set(driveFileId, {
                id,
                meetingId,
                conferenceRecord,
                kind,
                driveFileId,
                title,
                mimeType,
                webViewLink,
                createdAt,
                sharedAt: null,
                attachedAt: null,
                lastError: null,
                attempts: 0,
              });
            }
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
    artifacts: () => [...byDriveId.values()],
    transcriptStats,
  };
}

async function createEnvFixture(meeting: MeetingRecord | null = ACTIVE_MEETING) {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-proc-refresh",
  );
  const connection: GoogleConnectionRow = {
    id: 1,
    email: HOST_EMAIL,
    google_user_id: "110111222333",
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_nonce: encrypted.nonce,
    encryption_key_version: encrypted.keyVersion,
    scope: "https://www.googleapis.com/auth/drive",
    connected_by_user_id: "admin-1",
    connected_at: "2026-11-19T00:00:00.000Z",
    updated_at: "2026-11-19T00:00:00.000Z",
    status: "connected",
    last_error: null,
  };
  const dbFixture = createFakeProcessDb(connection, meeting);
  const queueSend = vi.fn().mockResolvedValue(undefined);
  const env = {
    DB: dbFixture.db,
    MEET_JOBS: { send: queueSend },
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
  } as unknown as Env;
  return { env, queueSend, ...dbFixture };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("processArtifactJob", () => {
  it("transcript と smartNote が同一 drive_file_id を返すとき kind='notes' の 1 行に統合される", async () => {
    const { env, queueSend, artifacts } = await createEnvFixture();
    let seq = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.proc", expires_in: 3600 });
      }
      if (url.includes("/transcripts/tr-1")) {
        return Response.json({
          name: "conferenceRecords/conf-1/transcripts/tr-1",
          state: "FILE_GENERATED",
          docsDestination: { document: "doc-shared-1" },
        });
      }
      if (url.includes("/smartNotes/sn-1")) {
        return Response.json({
          name: "conferenceRecords/conf-1/smartNotes/sn-1",
          state: "FILE_GENERATED",
          docsDestination: { document: "doc-shared-1" },
        });
      }
      if (url.includes("/drive/v3/files/doc-shared-1")) {
        return Response.json({
          id: "doc-shared-1",
          name: "定例会議 - 2026/11/19 - Gemini によるメモ",
          mimeType: "application/vnd.google-apps.document",
          webViewLink: "https://docs.google.com/document/d/doc-shared-1/edit",
          createdTime: "2026-11-19T11:03:30.000Z",
        });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    await processArtifactJob(
      env,
      {
        meetingId: "mtg-1",
        kind: "transcript",
        conferenceRecord: "conferenceRecords/conf-1",
        resourceName: "conferenceRecords/conf-1/transcripts/tr-1",
      },
      { fetchFn: fetchMock, generateId: () => `art-${++seq}` },
    );

    await processArtifactJob(
      env,
      {
        meetingId: "mtg-1",
        kind: "smartNote",
        conferenceRecord: "conferenceRecords/conf-1",
        resourceName: "conferenceRecords/conf-1/smartNotes/sn-1",
      },
      { fetchFn: fetchMock, generateId: () => `art-${++seq}` },
    );

    expect(artifacts()).toHaveLength(1);
    expect(artifacts()[0]).toMatchObject({
      id: "art-1",
      kind: "notes",
      driveFileId: "doc-shared-1",
    });
    expect(queueSend).toHaveBeenCalledWith({ type: "share_artifact", artifactId: "art-1" });
    expect(queueSend).toHaveBeenCalledWith({
      type: "collect_transcript_stats",
      conferenceRecord: "conferenceRecords/conf-1",
      transcript: "conferenceRecords/conf-1/transcripts/tr-1",
    });
  });

  it("親フォルダーに同スペース別会議のファイルが混在していても、今回の録画に対応するチャット記録 1 件だけを拾う", async () => {
    const { env, queueSend, artifacts } = await createEnvFixture();
    let seq = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.proc", expires_in: 3600 });
      }
      if (url.includes("/recordings/rec-2")) {
        return Response.json({
          name: "conferenceRecords/conf-2/recordings/rec-2",
          state: "FILE_GENERATED",
          driveDestination: { file: "rec-file-2" },
        });
      }
      if (url.includes("/drive/v3/files/rec-file-2")) {
        return Response.json({
          id: "rec-file-2",
          name: "abc-defg-hij (2026-11-19 19:00 GMT+9)",
          mimeType: "video/mp4",
          parents: ["shared-meet-folder"],
          webViewLink: "https://drive.google.com/file/d/rec-file-2/view",
          createdTime: "2026-11-19T11:05:00.000Z",
        });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
        return Response.json({
          files: [
            // 別会議のチャット記録（名前も作成時刻も異なる）
            {
              id: "chat-other-meeting",
              name: "abc-defg-hij (2026-11-12 19:00 GMT+9) - チャットの記録",
              mimeType: "text/plain",
              webViewLink: "https://drive.google.com/file/d/chat-other-meeting/view",
              createdTime: "2026-11-12T11:05:00.100Z",
            },
            // 名前は前方一致するが作成時刻が 5 分離れている無関係ファイル
            {
              id: "chat-too-far",
              name: "abc-defg-hij (2026-11-19 19:00 GMT+9) - メモ",
              mimeType: "text/plain",
              webViewLink: "https://drive.google.com/file/d/chat-too-far/view",
              createdTime: "2026-11-19T11:10:00.000Z",
            },
            // 今回の録画の 0.05 秒後に作られた本物のチャット記録
            {
              id: "chat-current-meeting",
              name: "abc-defg-hij (2026-11-19 19:00 GMT+9) - チャットの記録",
              mimeType: "text/plain",
              webViewLink: "https://drive.google.com/file/d/chat-current-meeting/view",
              createdTime: "2026-11-19T11:05:00.050Z",
            },
          ],
        });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    await processArtifactJob(
      env,
      {
        meetingId: "mtg-1",
        kind: "recording",
        conferenceRecord: "conferenceRecords/conf-2",
        resourceName: "conferenceRecords/conf-2/recordings/rec-2",
      },
      { fetchFn: fetchMock, generateId: () => `art-${++seq}` },
    );

    expect(artifacts().map((a) => ({ kind: a.kind, driveFileId: a.driveFileId }))).toEqual([
      { kind: "recording", driveFileId: "rec-file-2" },
      { kind: "chat_log", driveFileId: "chat-current-meeting" },
    ]);
    expect(queueSend).toHaveBeenCalledTimes(2);
    expect(queueSend).toHaveBeenNthCalledWith(1, { type: "share_artifact", artifactId: "art-1" });
    expect(queueSend).toHaveBeenNthCalledWith(2, { type: "share_artifact", artifactId: "art-2" });
  });

  it("state が FILE_GENERATED でない場合は一時不整合としてエラーを投げる", async () => {
    const { env, queueSend } = await createEnvFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.proc", expires_in: 3600 });
      }
      return Response.json({
        name: "conferenceRecords/conf-1/recordings/rec-pending",
        state: "ENDED",
      });
    }) as unknown as typeof fetch;

    await expect(
      processArtifactJob(
        env,
        {
          meetingId: "mtg-1",
          kind: "recording",
          conferenceRecord: "conferenceRecords/conf-1",
          resourceName: "conferenceRecords/conf-1/recordings/rec-pending",
        },
        { fetchFn: fetchMock },
      ),
    ).rejects.toThrow("生成完了していません");
    expect(queueSend).not.toHaveBeenCalled();
  });
});
