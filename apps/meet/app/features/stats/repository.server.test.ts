import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { MeetingInviteeRecord } from "~/features/meetings/meeting";
import {
  ensureTranscriptStatsPending,
  expireStaleConferenceStats,
  expireStaleTranscriptStats,
  getMeetingStatsForViewer,
  listPendingConferenceStatsForCron,
  listPendingTranscriptStatsForCron,
  saveConferenceStatsCollected,
  saveTranscriptStatsPageBatch,
  upsertConferenceParticipants,
} from "./repository.server";

function createStatsTestDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL
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

const SAMPLE_INVITEES: MeetingInviteeRecord[] = [
  {
    meetingId: "mtg-1",
    emailNormalized: "cohost@example.com",
    email: "cohost@example.com",
    displayName: "共同主催者A",
    userId: "u-1",
    role: "cohost",
    sourceKinds: ["creator"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "absent@example.com",
    email: "absent@example.com",
    displayName: "欠席者B",
    userId: "u-2",
    role: "participant",
    sourceKinds: ["email"],
  },
];

describe("stats repository", () => {
  it("getMeetingStatsForViewer は非 cohost へ個人別行を返さず、cohost へは未出席招待者・マスク済みメール・発言時間付きで返す", async () => {
    const { raw, db } = createStatsTestDb();

    raw.prepare("INSERT INTO meetings (id, title) VALUES (?, ?)").run("mtg-1", "定例会議");
    raw
      .prepare(
        `INSERT INTO conference_records (name, meeting_id, start_time, end_time, stats_status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "conferenceRecords/cr-skipped",
        "mtg-1",
        "2026-11-18T10:00:00Z",
        "2026-11-18T10:01:00Z",
        "skipped",
      );
    raw
      .prepare(
        `INSERT INTO conference_records (name, meeting_id, start_time, end_time, stats_status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "conferenceRecords/cr-1",
        "mtg-1",
        "2026-11-19T10:00:00Z",
        "2026-11-19T11:00:00Z",
        "pending",
      );

    await upsertConferenceParticipants(db, [
      {
        name: "conferenceRecords/cr-1/participants/host",
        conferenceRecord: "conferenceRecords/cr-1",
        meetingId: "mtg-1",
        kind: "signedin",
        googleUser: "users/999",
        displayName: "Host",
        isHostAccount: true,
        inviteeEmailNormalized: null,
        earliestStartTime: "2026-11-19T10:00:00Z",
        latestEndTime: "2026-11-19T11:00:00Z",
      },
      {
        name: "conferenceRecords/cr-1/participants/p1",
        conferenceRecord: "conferenceRecords/cr-1",
        meetingId: "mtg-1",
        kind: "signedin",
        googleUser: "users/101",
        displayName: "Meet Display Name",
        isHostAccount: false,
        inviteeEmailNormalized: "cohost@example.com",
        earliestStartTime: "2026-11-19T10:01:00Z",
        latestEndTime: "2026-11-19T10:55:00Z",
      },
      {
        name: "conferenceRecords/cr-1/participants/p2",
        conferenceRecord: "conferenceRecords/cr-1",
        meetingId: "mtg-1",
        kind: "anonymous",
        googleUser: null,
        displayName: "匿名ゲスト",
        isHostAccount: false,
        inviteeEmailNormalized: null,
        earliestStartTime: "2026-11-19T10:05:00Z",
        latestEndTime: "2026-11-19T10:25:00Z",
      },
    ]);

    await saveConferenceStatsCollected(
      db,
      "conferenceRecords/cr-1",
      {
        participantCount: 2,
        inviteeAttendedCount: 1,
        peakConcurrent: 2,
        totalAttendanceSeconds: 4440,
        participants: [
          { name: "conferenceRecords/cr-1/participants/host", sessionCount: 1, totalSeconds: 3600 },
          { name: "conferenceRecords/cr-1/participants/p1", sessionCount: 2, totalSeconds: 3240 },
          { name: "conferenceRecords/cr-1/participants/p2", sessionCount: 1, totalSeconds: 1200 },
        ],
      },
      "2026-11-19T11:05:00Z",
    );

    await ensureTranscriptStatsPending(
      db,
      "conferenceRecords/cr-1/transcripts/tr-1",
      "conferenceRecords/cr-1",
    );
    await saveTranscriptStatsPageBatch(db, {
      transcript: "conferenceRecords/cr-1/transcripts/tr-1",
      clearExisting: true,
      deltas: [
        {
          participant: "conferenceRecords/cr-1/participants/p1",
          entryCount: 3,
          charCount: 42,
          speakingSeconds: 18,
        },
      ],
      collectedAt: "2026-11-19T11:06:00Z",
    });

    const viewerStats = await getMeetingStatsForViewer(db, {
      meetingId: "mtg-1",
      invitees: SAMPLE_INVITEES,
      includeParticipants: false,
    });
    expect(viewerStats).toHaveLength(1);
    expect(viewerStats[0]).toEqual({
      name: "conferenceRecords/cr-1",
      startTime: "2026-11-19T10:00:00Z",
      endTime: "2026-11-19T11:00:00Z",
      statsStatus: "collected",
      participantCount: 2,
      inviteeAttendedCount: 1,
      totalInviteeCount: 2,
      peakConcurrent: 2,
      totalAttendanceSeconds: 4440,
      nonInviteeCount: 0,
      anonymousCount: 1,
      phoneCount: 0,
      transcriptStatsStatus: "collected",
      participants: null,
    });

    const cohostStats = await getMeetingStatsForViewer(db, {
      meetingId: "mtg-1",
      invitees: SAMPLE_INVITEES,
      includeParticipants: true,
    });
    expect(cohostStats[0]?.participants).toEqual([
      {
        key: "conferenceRecords/cr-1:conferenceRecords/cr-1/participants/p1",
        displayName: "共同主催者A",
        maskedEmail: "c***@example.com",
        category: "cohost",
        attended: true,
        earliestStartTime: "2026-11-19T10:01:00Z",
        latestEndTime: "2026-11-19T10:55:00Z",
        totalSeconds: 3240,
        sessionCount: 2,
        speakingSeconds: 18,
      },
      {
        key: "conferenceRecords/cr-1:conferenceRecords/cr-1/participants/p2",
        displayName: "匿名ゲスト",
        maskedEmail: null,
        category: "anonymous",
        attended: true,
        earliestStartTime: "2026-11-19T10:05:00Z",
        latestEndTime: "2026-11-19T10:25:00Z",
        totalSeconds: 1200,
        sessionCount: 1,
        speakingSeconds: 0,
      },
      {
        key: "conferenceRecords/cr-1:absent:0",
        displayName: "欠席者B",
        maskedEmail: "a***@example.com",
        category: "invitee",
        attended: false,
        earliestStartTime: null,
        latestEndTime: null,
        totalSeconds: 0,
        sessionCount: 0,
        speakingSeconds: null,
      },
    ]);
    expect(JSON.stringify(cohostStats)).not.toContain("cohost@example.com");
    expect(JSON.stringify(cohostStats)).not.toContain("absent@example.com");
  });

  it("cron 用クエリが期限切れを expired へ更新し、再投入対象だけを抽出する", async () => {
    const { raw, db } = createStatsTestDb();
    raw.prepare("INSERT INTO meetings (id, title) VALUES (?, ?)").run("mtg-1", "定例");

    raw
      .prepare(
        `INSERT INTO conference_records (name, meeting_id, end_time, expire_time, stats_status, stats_attempts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "conferenceRecords/expired",
        "mtg-1",
        "2026-10-01T10:00:00Z",
        "2026-11-01T10:00:00Z",
        "pending",
        0,
      );
    raw
      .prepare(
        `INSERT INTO conference_records (name, meeting_id, end_time, expire_time, stats_status, stats_attempts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "conferenceRecords/eligible",
        "mtg-1",
        "2026-11-19T10:00:00Z",
        "2026-12-19T10:00:00Z",
        "failed",
        2,
      );
    raw
      .prepare(
        `INSERT INTO conference_records (name, meeting_id, end_time, expire_time, stats_status, stats_attempts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "conferenceRecords/maxed",
        "mtg-1",
        "2026-11-19T09:00:00Z",
        "2026-12-19T09:00:00Z",
        "failed",
        10,
      );

    await ensureTranscriptStatsPending(
      db,
      "conferenceRecords/expired/transcripts/t-exp",
      "conferenceRecords/expired",
    );
    await ensureTranscriptStatsPending(
      db,
      "conferenceRecords/eligible/transcripts/t-ok",
      "conferenceRecords/eligible",
    );

    const nowIso = "2026-11-19T12:00:00Z";
    const endedBeforeIso = "2026-11-19T11:30:00Z";

    expect(await expireStaleConferenceStats(db, nowIso)).toBe(1);
    expect(await expireStaleTranscriptStats(db, nowIso)).toBe(1);
    expect(await listPendingConferenceStatsForCron(db, { endedBeforeIso, nowIso })).toEqual([
      "conferenceRecords/eligible",
    ]);
    expect(await listPendingTranscriptStatsForCron(db, { nowIso })).toEqual([
      {
        transcript: "conferenceRecords/eligible/transcripts/t-ok",
        conferenceRecord: "conferenceRecords/eligible",
      },
    ]);
  });

  it("Queue の再試行切れで collecting のまま止まった記録を cron が拾い直す", async () => {
    const { raw, db } = createStatsTestDb();
    raw.prepare("INSERT INTO meetings (id, title) VALUES (?, ?)").run("mtg-1", "定例");
    const insert = raw.prepare(
      `INSERT INTO conference_records (name, meeting_id, end_time, expire_time, stats_status, stats_attempts)
       VALUES (?, ?, ?, ?, 'collecting', 1)`,
    );
    insert.run("conferenceRecords/stuck", "mtg-1", "2026-11-19T09:00:00Z", "2026-12-19T09:00:00Z");
    insert.run(
      "conferenceRecords/running",
      "mtg-1",
      "2026-11-19T11:00:00Z",
      "2026-12-19T11:00:00Z",
    );

    const params = { endedBeforeIso: "2026-11-19T11:30:00Z", nowIso: "2026-11-19T12:00:00Z" };
    expect(
      await listPendingConferenceStatsForCron(db, {
        ...params,
        staleCollectingBeforeIso: "2026-11-19T10:00:00Z",
      }),
    ).toEqual(["conferenceRecords/stuck"]);
    expect(await listPendingConferenceStatsForCron(db, params)).toEqual([]);
  });
});
