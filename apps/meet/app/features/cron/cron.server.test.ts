import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "~/features/artifacts/artifact";
import {
  type GoogleSubscriptionRecord,
  WORKSPACE_EVENT_TYPES,
} from "~/features/events/subscription.server";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import type { MeetingRecord } from "~/features/meetings/meeting";
import { runMeetCron } from "./cron.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(8)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";
const TOPIC = "projects/gdgs-meet/topics/meet-events";

const RECENT_MEETING: MeetingRecord = {
  id: "mtg-recent",
  hostChapterId: 1,
  title: "最近の会議",
  description: "",
  startAt: "2026-11-18T10:00:00.000Z",
  endAt: "2026-11-18T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "RESTRICTED",
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
  spaceName: "spaces/recent-1",
  meetingUri: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
  calendarEventId: "evt-1",
  calendarHtmlLink: null,
  status: "active",
  lastError: null,
  createdByUserId: "u-1",
  createdByEmail: "organizer@example.com",
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
  canceledAt: null,
};

function createFakeCronDb(options: {
  connection: GoogleConnectionRow | null;
  subscription: GoogleSubscriptionRecord | null;
  meetings: MeetingRecord[];
  artifacts: ArtifactRecord[];
  conferenceRecords?: Array<{
    name: string;
    meetingId: string;
    endTime: string | null;
    expireTime: string | null;
    statsStatus: string;
    statsAttempts: number;
  }>;
  transcriptStats?: Array<{
    transcript: string;
    conferenceRecord: string;
    status: string;
    attempts: number;
  }>;
}) {
  let currentSub = options.subscription ? { ...options.subscription } : null;
  const conferenceRecords = new Map(
    (options.conferenceRecords ?? []).map((r) => [r.name, { ...r }]),
  );
  const transcriptStats = new Map(
    (options.transcriptStats ?? []).map((t) => [t.transcript, { ...t }]),
  );

  const toArtifactRow = (a: ArtifactRecord) => ({
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
            return options.connection as T | null;
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
          if (sql.includes("FROM artifacts WHERE drive_file_id = ?")) {
            const hit = options.artifacts.find((a) => a.driveFileId === String(args[0]));
            return (hit ? toArtifactRow(hit) : null) as T | null;
          }
          if (sql.includes("FROM conference_transcript_stats WHERE transcript = ?")) {
            const hit = transcriptStats.get(String(args[0]));
            if (!hit) return null;
            return {
              transcript: hit.transcript,
              conference_record: hit.conferenceRecord,
              status: hit.status,
              attempts: hit.attempts,
              collected_at: null,
              last_error: null,
            } as T;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async all<T>() {
          if (sql.includes("FROM conference_records") && sql.includes("stats_status IN")) {
            const [endedBeforeIso, staleCollectingBeforeIso, nowIso, maxAttempts] = args as [
              string,
              string,
              string,
              number,
            ];
            return {
              results: [...conferenceRecords.values()]
                .filter(
                  (r) =>
                    r.endTime !== null &&
                    (((r.statsStatus === "pending" || r.statsStatus === "failed") &&
                      r.endTime < endedBeforeIso) ||
                      (r.statsStatus === "collecting" && r.endTime < staleCollectingBeforeIso)) &&
                    (r.expireTime === null || r.expireTime > nowIso) &&
                    r.statsAttempts < maxAttempts,
                )
                .map((r) => ({ name: r.name })) as T[],
            };
          }
          if (sql.includes("FROM conference_transcript_stats ts")) {
            const [nowIso, maxAttempts] = args as [string, number];
            return {
              results: [...transcriptStats.values()]
                .filter((t) => {
                  const cr = conferenceRecords.get(t.conferenceRecord);
                  return (
                    (t.status === "pending" || t.status === "failed") &&
                    (!cr || cr.expireTime === null || cr.expireTime > nowIso) &&
                    t.attempts < maxAttempts
                  );
                })
                .map((t) => ({
                  transcript: t.transcript,
                  conference_record: t.conferenceRecord,
                })) as T[],
            };
          }
          if (sql.includes("FROM meetings")) {
            return {
              results: options.meetings.map((m) => ({
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
              })) as T[],
            };
          }
          if (sql.includes("FROM artifacts") && sql.includes("attempts < ?")) {
            const maxAttempts = Number(args[0]);
            return {
              results: options.artifacts
                .filter(
                  (a) => (a.sharedAt === null || a.attachedAt === null) && a.attempts < maxAttempts,
                )
                .map(toArtifactRow) as T[],
            };
          }
          throw new Error(`未対応の all(): ${sql}`);
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
          if (sql.includes("INSERT INTO conference_records")) {
            const [name, meetingId, , endTime, expireTime] = args as [
              string,
              string,
              string | null,
              string | null,
              string | null,
            ];
            if (!conferenceRecords.has(name)) {
              conferenceRecords.set(name, {
                name,
                meetingId,
                endTime: endTime ?? null,
                expireTime: expireTime ?? null,
                statsStatus: "pending",
                statsAttempts: 0,
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("INSERT OR IGNORE INTO conference_transcript_stats")) {
            const [transcript, conferenceRecord] = args as [string, string];
            if (!transcriptStats.has(transcript)) {
              transcriptStats.set(transcript, {
                transcript,
                conferenceRecord,
                status: "pending",
                attempts: 0,
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (
            sql.includes("UPDATE conference_records") &&
            sql.includes("stats_status = 'expired'")
          ) {
            const nowIso = String(args[0]);
            let changes = 0;
            for (const r of conferenceRecords.values()) {
              if (
                (r.statsStatus === "pending" ||
                  r.statsStatus === "collecting" ||
                  r.statsStatus === "failed") &&
                r.expireTime !== null &&
                r.expireTime <= nowIso
              ) {
                r.statsStatus = "expired";
                changes += 1;
              }
            }
            return { success: true, meta: { changes } };
          }
          if (
            sql.includes("UPDATE conference_transcript_stats") &&
            sql.includes("status = 'expired'")
          ) {
            const nowIso = String(args[0]);
            let changes = 0;
            for (const t of transcriptStats.values()) {
              const cr = conferenceRecords.get(t.conferenceRecord);
              if (
                (t.status === "pending" || t.status === "failed") &&
                cr?.expireTime !== null &&
                cr?.expireTime !== undefined &&
                cr.expireTime <= nowIso
              ) {
                t.status = "expired";
                changes += 1;
              }
            }
            return { success: true, meta: { changes } };
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
    conferenceRecords,
    transcriptStats,
  };
}

async function createEnvFixture(options: {
  connected?: boolean;
  subscription?: GoogleSubscriptionRecord | null;
  meetings?: MeetingRecord[];
  artifacts?: ArtifactRecord[];
  conferenceRecords?: Array<{
    name: string;
    meetingId: string;
    endTime: string | null;
    expireTime: string | null;
    statsStatus: string;
    statsAttempts: number;
  }>;
  transcriptStats?: Array<{
    transcript: string;
    conferenceRecord: string;
    status: string;
    attempts: number;
  }>;
}) {
  let connection: GoogleConnectionRow | null = null;
  if (options.connected !== false) {
    const encrypted = await encryptRefreshToken(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
      GOOGLE_CONNECTION_AAD,
      "1//0g-cron-refresh",
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

  const dbFixture = createFakeCronDb({
    connection,
    subscription: options.subscription ?? null,
    meetings: options.meetings ?? [],
    artifacts: options.artifacts ?? [],
    conferenceRecords: options.conferenceRecords,
    transcriptStats: options.transcriptStats,
  });
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

describe("runMeetCron", () => {
  it("google_connection が未接続のときは何もせずスキップする", async () => {
    const { env, queueSend } = await createEnvFixture({ connected: false });
    const fetchMock = vi.fn() as unknown as typeof fetch;

    const summary = await runMeetCron(env, { fetchFn: fetchMock });

    expect(summary.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("購読延長・過去 7 日会議の取りこぼし補完（重複 doc 統合）・未完了 artifact 回収の 3 段を実行する", async () => {
    const existingArtifact: ArtifactRecord = {
      id: "art-existing",
      meetingId: "mtg-recent",
      conferenceRecord: "conferenceRecords/conf-1",
      kind: "recording",
      driveFileId: "already-saved-rec",
      title: "既存録画",
      mimeType: "video/mp4",
      webViewLink: "https://drive.google.com/file/d/already-saved-rec/view",
      createdAt: "2026-11-18T11:05:00.000Z",
      sharedAt: "2026-11-18T11:06:00.000Z",
      attachedAt: "2026-11-18T11:06:00.000Z",
      lastError: null,
      attempts: 0,
    };
    const pendingArtifact: ArtifactRecord = {
      ...existingArtifact,
      id: "art-pending",
      driveFileId: "pending-file",
      sharedAt: "2026-11-18T11:06:00.000Z",
      attachedAt: null,
      attempts: 3,
    };
    const exhaustedArtifact: ArtifactRecord = {
      ...existingArtifact,
      id: "art-exhausted",
      driveFileId: "exhausted-file",
      sharedAt: null,
      attachedAt: null,
      attempts: 20,
    };

    const { env, queueSend, getSubscription, conferenceRecords } = await createEnvFixture({
      subscription: {
        name: "subscriptions/sub-cron",
        state: "ACTIVE",
        // 残 1 日（2 日未満）→ TTL 延長対象
        expireTime: "2026-11-20T12:00:00.000Z",
        updatedAt: "2026-11-14T00:00:00.000Z",
        lastError: null,
      },
      meetings: [RECENT_MEETING],
      artifacts: [existingArtifact, pendingArtifact, exhaustedArtifact],
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.cron", expires_in: 3600 });
      }
      if (url.endsWith("/v1/subscriptions/sub-cron") && (init?.method ?? "GET") === "GET") {
        return Response.json({
          name: "subscriptions/sub-cron",
          targetResource: "//cloudidentity.googleapis.com/users/110111222333",
          eventTypes: [...WORKSPACE_EVENT_TYPES],
          notificationEndpoint: { pubsubTopic: TOPIC },
          state: "ACTIVE",
          expireTime: "2026-11-20T12:00:00.000Z",
        });
      }
      if (url.includes("/v1/subscriptions/sub-cron") && init?.method === "PATCH") {
        return Response.json({
          name: "operations/op-extend",
          done: true,
          response: {
            name: "subscriptions/sub-cron",
            targetResource: "//cloudidentity.googleapis.com/users/110111222333",
            eventTypes: [...WORKSPACE_EVENT_TYPES],
            notificationEndpoint: { pubsubTopic: TOPIC },
            state: "ACTIVE",
            expireTime: "2026-11-26T12:00:00.000Z",
          },
        });
      }
      if (url.startsWith("https://meet.googleapis.com/v2/conferenceRecords?")) {
        return Response.json({
          conferenceRecords: [
            {
              name: "conferenceRecords/conf-1",
              space: "spaces/recent-1",
              startTime: "2026-11-18T10:00:00Z",
              endTime: "2026-11-18T11:00:00Z",
            },
          ],
        });
      }
      if (url.endsWith("/conferenceRecords/conf-1/recordings")) {
        return Response.json({
          recordings: [
            // 既に保存済み → 再投入しない
            {
              name: "conferenceRecords/conf-1/recordings/rec-old",
              state: "FILE_GENERATED",
              driveDestination: { file: "already-saved-rec" },
            },
            // 取りこぼし → process_artifact 投入
            {
              name: "conferenceRecords/conf-1/recordings/rec-missed",
              state: "FILE_GENERATED",
              driveDestination: { file: "missed-rec-file" },
            },
          ],
        });
      }
      if (url.endsWith("/conferenceRecords/conf-1/transcripts")) {
        return Response.json({
          transcripts: [
            {
              name: "conferenceRecords/conf-1/transcripts/tr-missed",
              state: "FILE_GENERATED",
              docsDestination: { document: "missed-doc-shared" },
            },
          ],
        });
      }
      if (url.endsWith("/conferenceRecords/conf-1/smartNotes")) {
        return Response.json({
          smartNotes: [
            // transcript と同じ document ID → 重複投入しない
            {
              name: "conferenceRecords/conf-1/smartNotes/sn-missed",
              state: "FILE_GENERATED",
              docsDestination: { document: "missed-doc-shared" },
            },
          ],
        });
      }
      throw new Error(`想定外の fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    const summary = await runMeetCron(env, {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-19T12:00:00.000Z"),
    });

    expect(summary).toEqual({
      skipped: false,
      subscriptionAction: "extended",
      backfilledProcessJobs: 2,
      requeuedShareJobs: 1,
      enqueuedStatsJobs: 2,
      expiredStatsRecords: 0,
      errors: [],
    });
    expect(getSubscription()?.expireTime).toBe("2026-11-26T12:00:00.000Z");
    expect(conferenceRecords.has("conferenceRecords/conf-1")).toBe(true);
    expect(queueSend).toHaveBeenCalledTimes(5);
    expect(queueSend).toHaveBeenNthCalledWith(1, {
      type: "collect_transcript_stats",
      conferenceRecord: "conferenceRecords/conf-1",
      transcript: "conferenceRecords/conf-1/transcripts/tr-missed",
    });
    expect(queueSend).toHaveBeenNthCalledWith(2, {
      type: "process_artifact",
      meetingId: "mtg-recent",
      kind: "recording",
      conferenceRecord: "conferenceRecords/conf-1",
      resourceName: "conferenceRecords/conf-1/recordings/rec-missed",
    });
    expect(queueSend).toHaveBeenNthCalledWith(3, {
      type: "process_artifact",
      meetingId: "mtg-recent",
      kind: "transcript",
      conferenceRecord: "conferenceRecords/conf-1",
      resourceName: "conferenceRecords/conf-1/transcripts/tr-missed",
    });
    expect(queueSend).toHaveBeenNthCalledWith(4, {
      type: "share_artifact",
      artifactId: "art-pending",
    });
    expect(queueSend).toHaveBeenNthCalledWith(5, {
      type: "collect_conference_stats",
      conferenceRecord: "conferenceRecords/conf-1",
    });
  });

  it("ステップ 4 で期限切れレコードを expired へ更新し、未完了統計のみ Meet API 呼び出しなしで再投入する", async () => {
    const { env, queueSend, conferenceRecords, transcriptStats } = await createEnvFixture({
      subscription: {
        name: "subscriptions/sub-cron",
        state: "ACTIVE",
        expireTime: "2026-11-26T12:00:00.000Z",
        updatedAt: "2026-11-18T00:00:00.000Z",
        lastError: null,
      },
      conferenceRecords: [
        {
          name: "conferenceRecords/expired",
          meetingId: "mtg-1",
          endTime: "2026-10-01T10:00:00.000Z",
          expireTime: "2026-11-01T10:00:00.000Z",
          statsStatus: "pending",
          statsAttempts: 0,
        },
        {
          name: "conferenceRecords/pending-ok",
          meetingId: "mtg-1",
          endTime: "2026-11-19T10:00:00.000Z",
          expireTime: "2026-12-19T10:00:00.000Z",
          statsStatus: "failed",
          statsAttempts: 1,
        },
        {
          name: "conferenceRecords/collected-done",
          meetingId: "mtg-1",
          endTime: "2026-11-19T08:00:00.000Z",
          expireTime: "2026-12-19T08:00:00.000Z",
          statsStatus: "collected",
          statsAttempts: 1,
        },
      ],
      transcriptStats: [
        {
          transcript: "conferenceRecords/expired/transcripts/t1",
          conferenceRecord: "conferenceRecords/expired",
          status: "pending",
          attempts: 0,
        },
        {
          transcript: "conferenceRecords/pending-ok/transcripts/t2",
          conferenceRecord: "conferenceRecords/pending-ok",
          status: "pending",
          attempts: 0,
        },
      ],
    });

    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.cron", expires_in: 3600 });
      }
      if (url.endsWith("/v1/subscriptions/sub-cron") && (init?.method ?? "GET") === "GET") {
        return Response.json({
          name: "subscriptions/sub-cron",
          targetResource: "//cloudidentity.googleapis.com/users/110111222333",
          eventTypes: [...WORKSPACE_EVENT_TYPES],
          notificationEndpoint: { pubsubTopic: TOPIC },
          state: "ACTIVE",
          expireTime: "2026-11-26T12:00:00.000Z",
        });
      }
      throw new Error(`想定外の Meet API 呼び出し: ${url}`);
    });

    const summary = await runMeetCron(env, {
      fetchFn: fetchSpy as unknown as typeof fetch,
      now: () => new Date("2026-11-19T12:00:00.000Z"),
    });

    expect(summary).toEqual({
      skipped: false,
      subscriptionAction: "kept",
      backfilledProcessJobs: 0,
      requeuedShareJobs: 0,
      enqueuedStatsJobs: 2,
      expiredStatsRecords: 2,
      errors: [],
    });
    expect(
      fetchSpy.mock.calls.some(([input]) => String(input).includes("meet.googleapis.com")),
    ).toBe(false);
    expect(conferenceRecords.get("conferenceRecords/expired")?.statsStatus).toBe("expired");
    expect(transcriptStats.get("conferenceRecords/expired/transcripts/t1")?.status).toBe("expired");
    expect(queueSend).toHaveBeenCalledTimes(2);
    expect(queueSend).toHaveBeenNthCalledWith(1, {
      type: "collect_conference_stats",
      conferenceRecord: "conferenceRecords/pending-ok",
    });
    expect(queueSend).toHaveBeenNthCalledWith(2, {
      type: "collect_transcript_stats",
      conferenceRecord: "conferenceRecords/pending-ok",
      transcript: "conferenceRecords/pending-ok/transcripts/t2",
    });
  });
});
