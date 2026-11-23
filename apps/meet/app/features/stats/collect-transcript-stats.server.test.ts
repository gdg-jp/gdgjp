import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import { collectTranscriptStatsJob } from "./collect-transcript-stats.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

function createFakeTranscriptDb(connection: GoogleConnectionRow) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE google_connection (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      google_user_id TEXT NOT NULL,
      refresh_token_ciphertext TEXT NOT NULL,
      refresh_token_nonce TEXT NOT NULL,
      encryption_key_version INTEGER NOT NULL,
      scope TEXT NOT NULL,
      connected_by_user_id TEXT NOT NULL,
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT
    );
    CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE conference_records (
      name TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
      start_time TEXT,
      end_time TEXT,
      expire_time TEXT,
      stats_status TEXT NOT NULL DEFAULT 'pending',
      stats_attempts INTEGER NOT NULL DEFAULT 0,
      stats_collected_at TEXT,
      stats_last_error TEXT,
      participant_count INTEGER,
      invitee_attended_count INTEGER,
      peak_concurrent INTEGER,
      total_attendance_seconds INTEGER
    );
    CREATE TABLE conference_transcript_stats (
      transcript TEXT PRIMARY KEY,
      conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      collected_at TEXT,
      last_error TEXT
    );
    CREATE TABLE conference_speaker_stats (
      transcript TEXT NOT NULL REFERENCES conference_transcript_stats (transcript) ON DELETE CASCADE,
      participant TEXT NOT NULL,
      entry_count INTEGER NOT NULL,
      char_count INTEGER NOT NULL,
      speaking_seconds INTEGER NOT NULL,
      PRIMARY KEY (transcript, participant)
    );
  `);

  raw
    .prepare(
      `INSERT INTO google_connection (
         id, email, google_user_id, refresh_token_ciphertext, refresh_token_nonce,
         encryption_key_version, scope, connected_by_user_id, connected_at, updated_at,
         status, last_error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      connection.id,
      connection.email,
      connection.google_user_id,
      connection.refresh_token_ciphertext,
      connection.refresh_token_nonce,
      connection.encryption_key_version,
      connection.scope,
      connection.connected_by_user_id,
      connection.connected_at,
      connection.updated_at,
      connection.status,
      connection.last_error,
    );

  raw.prepare("INSERT INTO meetings (id, title) VALUES (?, ?)").run("mtg-1", "定例");
  raw
    .prepare("INSERT INTO conference_records (name, meeting_id, expire_time) VALUES (?, ?, ?)")
    .run("conferenceRecords/cr-1", "mtg-1", "2026-12-19T11:00:00Z");

  const boundArgsLog: unknown[] = [];

  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => {
      boundArgsLog.push(...next);
      return statement(sql, next);
    },
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...(params as never[])) }),
    run: async () => {
      const info = raw.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
    _runSync: () => raw.prepare(sql).run(...(params as never[])),
  });

  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: Array<ReturnType<typeof statement>>) => {
      const results = [];
      for (const s of stmts) {
        const info = s._runSync();
        results.push({ success: true, meta: { changes: Number(info.changes) } });
      }
      return results;
    },
  };

  return { raw, db: db as unknown as D1Database, boundArgsLog };
}

async function createEnvFixture() {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-tr-refresh",
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
  const { raw, db, boundArgsLog } = createFakeTranscriptDb(connection);
  const queueSend = vi.fn().mockResolvedValue(undefined);
  const env = {
    DB: db,
    MEET_JOBS: { send: queueSend },
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
  } as unknown as Env;
  return { env, raw, queueSend, boundArgsLog };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("collectTranscriptStatsJob", () => {
  it("文字起こし本文（text）を D1 に一切書き込まず、複数ページ・継続ジョブを通じて統計のみを保存する", async () => {
    const { env, raw, queueSend, boundArgsLog } = await createEnvFixture();
    const transcriptName = "conferenceRecords/cr-1/transcripts/tr-1";
    raw
      .prepare(
        "INSERT INTO conference_transcript_stats (transcript, conference_record, status) VALUES (?, ?, ?)",
      )
      .run(transcriptName, "conferenceRecords/cr-1", "pending");

    const secretTranscriptBody1 = "機密の会議発言テキストその1";
    const secretTranscriptBody2 = "機密の会議発言テキストその2";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.tr", expires_in: 3600 });
      }
      if (!url.includes("pageToken=")) {
        return Response.json({
          transcriptEntries: [
            {
              name: `${transcriptName}/entries/1`,
              participant: "conferenceRecords/cr-1/participants/p1",
              text: secretTranscriptBody1,
              startTime: "2026-11-19T10:01:00Z",
              endTime: "2026-11-19T10:01:10Z",
            },
          ],
          nextPageToken: "tok-2",
        });
      }
      return Response.json({
        transcriptEntries: [
          {
            name: `${transcriptName}/entries/2`,
            participant: "conferenceRecords/cr-1/participants/p1",
            text: secretTranscriptBody2,
            startTime: "2026-11-19T10:02:00Z",
            endTime: "2026-11-19T10:02:15Z",
          },
        ],
      });
    }) as unknown as typeof fetch;

    await collectTranscriptStatsJob(
      env,
      { conferenceRecord: "conferenceRecords/cr-1", transcript: transcriptName },
      { fetchFn: fetchMock, minIntervalMs: 0, maxCalls: 1 },
    );

    expect(queueSend).toHaveBeenCalledWith(
      {
        type: "collect_transcript_stats",
        conferenceRecord: "conferenceRecords/cr-1",
        transcript: transcriptName,
        pageToken: "tok-2",
      },
      { delaySeconds: 30 },
    );

    await collectTranscriptStatsJob(
      env,
      {
        conferenceRecord: "conferenceRecords/cr-1",
        transcript: transcriptName,
        pageToken: "tok-2",
      },
      { fetchFn: fetchMock, minIntervalMs: 0, maxCalls: 1 },
    );

    const statusRow = raw
      .prepare("SELECT status FROM conference_transcript_stats WHERE transcript = ?")
      .get(transcriptName) as { status: string };
    expect(statusRow.status).toBe("collected");

    const speakerRow = raw
      .prepare(
        "SELECT entry_count, char_count, speaking_seconds FROM conference_speaker_stats WHERE transcript = ?",
      )
      .get(transcriptName) as {
      entry_count: number;
      char_count: number;
      speaking_seconds: number;
    };
    expect(speakerRow).toEqual({
      entry_count: 2,
      char_count: secretTranscriptBody1.length + secretTranscriptBody2.length,
      speaking_seconds: 25,
    });

    const serializedArgs = JSON.stringify(boundArgsLog);
    expect(serializedArgs).not.toContain(secretTranscriptBody1);
    expect(serializedArgs).not.toContain(secretTranscriptBody2);
  });

  it("collected / expired の文字起こしには fetch を 0 回しか呼ばない", async () => {
    const { env, raw } = await createEnvFixture();
    const fetchMock = vi.fn() as unknown as typeof fetch;

    raw
      .prepare(
        "INSERT INTO conference_transcript_stats (transcript, conference_record, status) VALUES (?, ?, ?)",
      )
      .run("conferenceRecords/cr-1/transcripts/tr-done", "conferenceRecords/cr-1", "collected");

    await collectTranscriptStatsJob(
      env,
      {
        conferenceRecord: "conferenceRecords/cr-1",
        transcript: "conferenceRecords/cr-1/transcripts/tr-done",
      },
      { fetchFn: fetchMock },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 エラー時は再スローし、status を failed に落とさない", async () => {
    const { env, raw } = await createEnvFixture();
    const transcriptName = "conferenceRecords/cr-1/transcripts/tr-429";
    raw
      .prepare(
        "INSERT INTO conference_transcript_stats (transcript, conference_record, status) VALUES (?, ?, ?)",
      )
      .run(transcriptName, "conferenceRecords/cr-1", "pending");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.tr", expires_in: 3600 });
      }
      return Response.json(
        { error: { status: "RESOURCE_EXHAUSTED", message: "Quota" } },
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    await expect(
      collectTranscriptStatsJob(
        env,
        { conferenceRecord: "conferenceRecords/cr-1", transcript: transcriptName },
        { fetchFn: fetchMock, minIntervalMs: 0 },
      ),
    ).rejects.toThrow(GoogleApiError);

    const row = raw
      .prepare("SELECT status FROM conference_transcript_stats WHERE transcript = ?")
      .get(transcriptName) as { status: string };
    expect(row.status).toBe("pending");
  });
});
