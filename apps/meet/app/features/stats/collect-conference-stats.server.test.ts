import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import { collectConferenceStatsJob } from "./collect-conference-stats.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";
const HOST_GOOGLE_USER_ID = "999000111";

function createFakeStatsJobDb(connection: GoogleConnectionRow) {
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
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      host_chapter_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      time_zone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
      access_type TEXT NOT NULL DEFAULT 'RESTRICTED',
      auto_transcription INTEGER NOT NULL DEFAULT 1,
      auto_smart_notes INTEGER NOT NULL DEFAULT 1,
      auto_recording INTEGER NOT NULL DEFAULT 0,
      space_name TEXT,
      meeting_uri TEXT,
      meeting_code TEXT,
      calendar_event_id TEXT,
      calendar_html_link TEXT,
      status TEXT NOT NULL,
      last_error TEXT,
      created_by_user_id TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      canceled_at TEXT
    );
    CREATE TABLE meeting_invitees (
      meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
      email_normalized TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT,
      user_id TEXT,
      role TEXT NOT NULL,
      source_kinds TEXT NOT NULL,
      google_user TEXT,
      PRIMARY KEY (meeting_id, email_normalized)
    );
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
    CREATE TABLE conference_participants (
      name TEXT PRIMARY KEY,
      conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
      meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      google_user TEXT,
      display_name TEXT,
      is_host_account INTEGER NOT NULL DEFAULT 0,
      invitee_email_normalized TEXT,
      earliest_start_time TEXT,
      latest_end_time TEXT,
      session_count INTEGER NOT NULL DEFAULT 0,
      total_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conference_participant_sessions (
      name TEXT PRIMARY KEY,
      participant TEXT NOT NULL REFERENCES conference_participants (name) ON DELETE CASCADE,
      start_time TEXT,
      end_time TEXT
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

  raw
    .prepare(
      `INSERT INTO meetings (
         id, host_chapter_id, title, start_at, end_at, space_name, status,
         created_by_user_id, created_by_email, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "mtg-1",
      1,
      "定例会議",
      "2026-11-19T10:00:00Z",
      "2026-11-19T11:00:00Z",
      "spaces/sp-1",
      "active",
      "u-1",
      "cohost@example.com",
      "2026-11-19T00:00:00Z",
      "2026-11-19T00:00:00Z",
    );

  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
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

  return { raw, db: db as unknown as D1Database };
}

async function createEnvFixture() {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-stats-refresh",
  );
  const connection: GoogleConnectionRow = {
    id: 1,
    email: HOST_EMAIL,
    google_user_id: HOST_GOOGLE_USER_ID,
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
  const { raw, db } = createFakeStatsJobDb(connection);
  const queueSend = vi.fn().mockResolvedValue(undefined);
  const env = {
    DB: db,
    MEET_JOBS: { send: queueSend },
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
  } as unknown as Env;
  return { env, raw, queueSend };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("collectConferenceStatsJob", () => {
  it("collected / skipped / expired のレコードに対して fetch を 0 回しか呼ばない", async () => {
    const { env, raw, queueSend } = await createEnvFixture();
    const fetchMock = vi.fn() as unknown as typeof fetch;

    for (const [idx, status] of ["collected", "skipped", "expired"].entries()) {
      const name = `conferenceRecords/done-${idx}`;
      raw
        .prepare("INSERT INTO conference_records (name, meeting_id, stats_status) VALUES (?, ?, ?)")
        .run(name, "mtg-1", status);
      await collectConferenceStatsJob(env, { conferenceRecord: name }, { fetchFn: fetchMock });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("参加者 0 人の開催回は skipped になる", async () => {
    const { env, raw } = await createEnvFixture();
    raw
      .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
      .run("conferenceRecords/empty", "mtg-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.stats", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/conferenceRecords/empty") {
        return Response.json({
          name: "conferenceRecords/empty",
          startTime: "2026-11-19T10:00:00Z",
          endTime: "2026-11-19T10:00:10Z",
          expireTime: "2026-12-19T10:00:10Z",
        });
      }
      if (url.includes("/participants?")) {
        return Response.json({ participants: [] });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    await collectConferenceStatsJob(
      env,
      { conferenceRecord: "conferenceRecords/empty" },
      { fetchFn: fetchMock, minIntervalMs: 0 },
    );

    const row = raw
      .prepare("SELECT stats_status FROM conference_records WHERE name = ?")
      .get("conferenceRecords/empty") as { stats_status: string };
    expect(row.stats_status).toBe("skipped");
  });

  it("latestEndTime が null の参加者がいる場合は collected にせず delaySeconds=300 で再投入する", async () => {
    const { env, raw, queueSend } = await createEnvFixture();
    raw
      .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
      .run("conferenceRecords/open-part", "mtg-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.stats", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/conferenceRecords/open-part") {
        return Response.json({
          name: "conferenceRecords/open-part",
          startTime: "2026-11-19T10:00:00Z",
          endTime: "2026-11-19T11:00:00Z",
          expireTime: "2026-12-19T11:00:00Z",
        });
      }
      if (url.includes("/participants?")) {
        return Response.json({
          participants: [
            {
              name: "conferenceRecords/open-part/participants/1",
              signedinUser: { user: "users/1", displayName: "A" },
              earliestStartTime: "2026-11-19T10:00:00Z",
            },
          ],
        });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    await collectConferenceStatsJob(
      env,
      { conferenceRecord: "conferenceRecords/open-part" },
      { fetchFn: fetchMock, minIntervalMs: 0 },
    );

    const row = raw
      .prepare("SELECT stats_status, stats_attempts FROM conference_records WHERE name = ?")
      .get("conferenceRecords/open-part") as { stats_status: string; stats_attempts: number };
    expect(row.stats_status).toBe("pending");
    expect(row.stats_attempts).toBe(1);
    expect(queueSend).toHaveBeenCalledWith(
      { type: "collect_conference_stats", conferenceRecord: "conferenceRecords/open-part" },
      { delaySeconds: 300 },
    );
  });

  it("予算上限（maxCalls）を超える参加者数のとき cursor 付き継続ジョブに分かれて完了し、同じ参加者を二重取得しない", async () => {
    const { env, raw, queueSend } = await createEnvFixture();
    raw
      .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
      .run("conferenceRecords/paged", "mtg-1");
    raw
      .prepare(
        `INSERT INTO meeting_invitees (
           meeting_id, email_normalized, email, display_name, user_id, role, source_kinds, google_user
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "mtg-1",
        "a@example.com",
        "a@example.com",
        "招待者A",
        "u-a",
        "cohost",
        '["creator"]',
        "users/101",
      );

    const sessionFetchCounts = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.stats", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/conferenceRecords/paged") {
        return Response.json({
          name: "conferenceRecords/paged",
          startTime: "2026-11-19T10:00:00Z",
          endTime: "2026-11-19T11:00:00Z",
          expireTime: "2026-12-19T11:00:00Z",
        });
      }
      if (url.includes("/participants?")) {
        return Response.json({
          participants: [
            {
              name: "conferenceRecords/paged/participants/host",
              signedinUser: { user: `users/${HOST_GOOGLE_USER_ID}`, displayName: "Host" },
              earliestStartTime: "2026-11-19T10:00:00Z",
              latestEndTime: "2026-11-19T11:00:00Z",
            },
            {
              name: "conferenceRecords/paged/participants/p1",
              signedinUser: { user: "users/101", displayName: "A" },
              earliestStartTime: "2026-11-19T10:00:00Z",
              latestEndTime: "2026-11-19T10:30:00Z",
            },
            {
              name: "conferenceRecords/paged/participants/p2",
              anonymousUser: { displayName: "Anon" },
              earliestStartTime: "2026-11-19T10:10:00Z",
              latestEndTime: "2026-11-19T10:40:00Z",
            },
            {
              name: "conferenceRecords/paged/participants/p3",
              phoneUser: { displayName: "090-xxxx" },
              earliestStartTime: "2026-11-19T10:20:00Z",
              latestEndTime: "2026-11-19T10:50:00Z",
            },
          ],
        });
      }
      const match = /\/participants\/([^/]+)\/participantSessions/.exec(url);
      if (match) {
        const pid = match[1];
        sessionFetchCounts.set(pid, (sessionFetchCounts.get(pid) ?? 0) + 1);
        return Response.json({
          participantSessions: [
            {
              name: `conferenceRecords/paged/participants/${pid}/participantSessions/1`,
              startTime: "2026-11-19T10:00:00Z",
              endTime: "2026-11-19T10:20:00Z",
            },
          ],
        });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    await collectConferenceStatsJob(
      env,
      { conferenceRecord: "conferenceRecords/paged" },
      { fetchFn: fetchMock, minIntervalMs: 0, maxCalls: 4 },
    );

    expect(queueSend).toHaveBeenCalledTimes(1);
    const continuationMsg = queueSend.mock.calls[0]?.[0] as {
      type: "collect_conference_stats";
      conferenceRecord: string;
      cursor?: string;
    };
    expect(continuationMsg.cursor).toBe("conferenceRecords/paged/participants/p1");
    expect(queueSend.mock.calls[0]?.[1]).toEqual({ delaySeconds: 30 });

    await collectConferenceStatsJob(env, continuationMsg, {
      fetchFn: fetchMock,
      minIntervalMs: 0,
      maxCalls: 4,
    });

    expect([...sessionFetchCounts.entries()].sort()).toEqual([
      ["host", 1],
      ["p1", 1],
      ["p2", 1],
      ["p3", 1],
    ]);

    const row = raw
      .prepare(
        "SELECT stats_status, participant_count, invitee_attended_count, peak_concurrent FROM conference_records WHERE name = ?",
      )
      .get("conferenceRecords/paged") as {
      stats_status: string;
      participant_count: number;
      invitee_attended_count: number;
      peak_concurrent: number;
    };
    expect(row).toEqual({
      stats_status: "collected",
      participant_count: 3,
      invitee_attended_count: 1,
      peak_concurrent: 3,
    });
  });

  it("Meet API の HTTP 429 に対して GoogleApiError を再スローし、stats_status を failed に落とさない", async () => {
    const { env, raw } = await createEnvFixture();
    raw
      .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
      .run("conferenceRecords/rate-limited", "mtg-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.stats", expires_in: 3600 });
      }
      return Response.json(
        { error: { status: "RESOURCE_EXHAUSTED", message: "Rate limit" } },
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    await expect(
      collectConferenceStatsJob(
        env,
        { conferenceRecord: "conferenceRecords/rate-limited" },
        { fetchFn: fetchMock, minIntervalMs: 0 },
      ),
    ).rejects.toThrow(GoogleApiError);

    const row = raw
      .prepare("SELECT stats_status, stats_last_error FROM conference_records WHERE name = ?")
      .get("conferenceRecords/rate-limited") as {
      stats_status: string;
      stats_last_error: string | null;
    };
    expect(row.stats_status).toBe("collecting");
    expect(row.stats_last_error).toBeNull();
  });
});
