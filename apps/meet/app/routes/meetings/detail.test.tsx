import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { getAuth } from "~/features/auth/auth.server";
import { loader } from "./detail";

const TEST_SESSION_SECRET = "test-rp-session-secret-32-chars-minimum";

function createDetailTestDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      image TEXT,
      oidc_issuer TEXT,
      oidc_subject TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE google_connection (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      google_user_id TEXT NOT NULL,
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
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
      conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      drive_file_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      web_view_link TEXT NOT NULL,
      created_at TEXT NOT NULL,
      shared_at TEXT,
      attached_at TEXT,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);

  raw
    .prepare(
      `INSERT INTO meetings (
         id, host_chapter_id, title, start_at, end_at, status,
         created_by_user_id, created_by_email, created_at, updated_at, canceled_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "mtg-1",
      1,
      "定例会議",
      "2026-11-19T10:00:00Z",
      "2026-11-19T11:00:00Z",
      "canceled",
      "dev-user-cohost",
      "cohost@dev.local",
      "2026-11-19T00:00:00Z",
      "2026-11-19T12:00:00Z",
      "2026-11-19T12:00:00Z",
    );
  raw
    .prepare(
      `INSERT INTO meeting_invitees (
         meeting_id, email_normalized, email, display_name, user_id, role, source_kinds
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "mtg-1",
      "cohost@dev.local",
      "cohost@dev.local",
      "Cohost User",
      "dev-user-cohost",
      "cohost",
      '["creator"]',
    );
  raw
    .prepare(
      `INSERT INTO meeting_invitees (
         meeting_id, email_normalized, email, display_name, user_id, role, source_kinds
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "mtg-1",
      "guest@dev.local",
      "guest@dev.local",
      "Guest User",
      "dev-user-guest",
      "participant",
      '["email"]',
    );
  raw
    .prepare(
      `INSERT INTO conference_records (
         name, meeting_id, start_time, end_time, stats_status,
         participant_count, invitee_attended_count, peak_concurrent, total_attendance_seconds
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "conferenceRecords/cr-1",
      "mtg-1",
      "2026-11-19T10:00:00Z",
      "2026-11-19T11:00:00Z",
      "collected",
      2,
      1,
      2,
      3600,
    );
  raw
    .prepare(
      `INSERT INTO conference_participants (
         name, conference_record, meeting_id, kind, google_user, display_name,
         is_host_account, invitee_email_normalized, earliest_start_time, latest_end_time,
         session_count, total_seconds
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "conferenceRecords/cr-1/participants/p1",
      "conferenceRecords/cr-1",
      "mtg-1",
      "signedin",
      "users/101",
      "Secret Participant Name",
      0,
      "cohost@dev.local",
      "2026-11-19T10:00:00Z",
      "2026-11-19T11:00:00Z",
      1,
      3600,
    );

  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...(params as never[])) }),
    run: async () => {
      const info = raw.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });

  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

async function createDevSessionRequest(env: Env, asUser: string) {
  const loginRes = await getAuth(env).handleDevLogin(
    new Request(`http://localhost:5193/dev/login?as=${asUser}&chapter=1:tokyo:organizer`),
  );
  const rawSetCookie = loginRes.headers.get("Set-Cookie") ?? "";
  const cookiePair = rawSetCookie.split(";")[0] ?? "";
  return new Request("http://localhost:5193/meetings/mtg-1", {
    headers: { Cookie: cookiePair },
  });
}

describe("meetings/detail loader", () => {
  it("非 cohost 閲覧者向けの loader レスポンスに個人別統計行を含めない（かつ Google API を呼ばない）", async () => {
    const db = createDetailTestDb();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = {
      DB: db,
      APP_URL: "http://localhost:5193",
      RP_SESSION_SECRET: TEST_SESSION_SECRET,
      IDP_URL: "https://accounts.gdgs.jp",
      IDP_CLIENT_ID: "meet",
      IDP_CLIENT_SECRET: "secret",
      ACCOUNTS_URL: "https://accounts.gdgs.jp",
      ACCOUNTS: {
        fetch: async () => Response.json({ chapters: [{ id: 1, name: "GDG Tokyo" }] }),
      },
      ACCOUNTS_DIRECTORY: {
        listUserAvatars: async () => ({}),
      },
    } as unknown as Env;

    const guestReq = await createDevSessionRequest(env, "guest");
    const guestData = await loader({
      request: guestReq,
      params: { id: "mtg-1" },
      context: { cloudflare: { env } },
    } as never);

    expect(guestData.conferenceStats).toHaveLength(1);
    expect(guestData.conferenceStats[0].participantCount).toBe(2);
    expect(guestData.conferenceStats[0].participants).toBeNull();
    expect(JSON.stringify(guestData.conferenceStats)).not.toContain("Secret Participant Name");
    expect(fetchSpy).not.toHaveBeenCalled();

    const cohostReq = await createDevSessionRequest(env, "cohost");
    const cohostData = await loader({
      request: cohostReq,
      params: { id: "mtg-1" },
      context: { cloudflare: { env } },
    } as never);

    expect(cohostData.canEdit).toBe(false);
    expect(cohostData.conferenceStats[0].participants).toHaveLength(2);
    expect(cohostData.conferenceStats[0].participants?.[0]?.maskedEmail).toBe("c***@dev.local");
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
