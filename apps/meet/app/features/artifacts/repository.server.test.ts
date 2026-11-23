import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  deleteArtifactShareFailuresForEmails,
  listArtifactShareFailureEmails,
  listCompletedWarningArtifacts,
  listFailedArtifacts,
  listMeetingArtifactShareFailures,
  listPendingArtifacts,
  upsertArtifactShareFailure,
  upsertConferenceRecord,
} from "./repository.server";

function createArtifactsDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      calendar_event_id TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE conference_records (
      name TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
      start_time TEXT,
      end_time TEXT,
      expire_time TEXT,
      stats_status TEXT NOT NULL DEFAULT 'pending',
      participant_count INTEGER
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
    CREATE TABLE artifact_share_failures (
      artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
      email_normalized TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      api_status TEXT,
      failed_at TEXT NOT NULL,
      PRIMARY KEY (artifact_id, email_normalized)
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
  });

  return {
    raw,
    db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database,
  };
}

describe("artifacts repository", () => {
  it("listFailedArtifacts と listCompletedWarningArtifacts で未完了・失敗と警告あり（完了済み）を正しく分離する", async () => {
    const { raw, db } = createArtifactsDb();

    raw
      .prepare("INSERT INTO meetings (id, title, calendar_event_id) VALUES (?, ?, ?)")
      .run("mtg-cal", "予定あり会議", "evt-1");
    raw
      .prepare("INSERT INTO meetings (id, title, calendar_event_id) VALUES (?, ?, ?)")
      .run("mtg-nocal", "予定なし会議", null);
    raw
      .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
      .run("conferenceRecords/1", "mtg-cal");
    raw
      .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
      .run("conferenceRecords/2", "mtg-nocal");

    const insertArt = raw.prepare(
      `INSERT INTO artifacts (
         id, meeting_id, conference_record, kind, drive_file_id, title, mime_type,
         web_view_link, created_at, shared_at, attached_at, last_error, attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insertArt.run(
      "art-unshared-err",
      "mtg-cal",
      "conferenceRecords/1",
      "recording",
      "df-1",
      "未共有エラー録画",
      "video/mp4",
      "https://drive.google.com/1",
      "2026-11-20T01:00:00.000Z",
      null,
      null,
      "500 INTERNAL",
      1,
    );
    insertArt.run(
      "art-unattached-warn",
      "mtg-cal",
      "conferenceRecords/1",
      "notes",
      "df-2",
      "未添付警告メモ",
      "application/vnd.google-apps.document",
      "https://drive.google.com/2",
      "2026-11-20T02:00:00.000Z",
      "2026-11-20T02:01:00.000Z",
      null,
      "一部招待者への Drive 共有をスキップしました (400)",
      0,
    );
    insertArt.run(
      "art-completed-warn",
      "mtg-cal",
      "conferenceRecords/1",
      "recording",
      "df-3",
      "完了済み警告録画",
      "video/mp4",
      "https://drive.google.com/3",
      "2026-11-20T03:00:00.000Z",
      "2026-11-20T03:01:00.000Z",
      "2026-11-20T03:01:00.000Z",
      "一部招待者への Drive 共有をスキップしました (400 invalidSharingRequest)",
      0,
    );
    insertArt.run(
      "art-nocal-warn",
      "mtg-nocal",
      "conferenceRecords/2",
      "chat_log",
      "df-4",
      "予定なし警告チャット",
      "text/plain",
      "https://drive.google.com/4",
      "2026-11-20T04:00:00.000Z",
      "2026-11-20T04:01:00.000Z",
      null,
      "一部招待者への Drive 共有をスキップしました (400)",
      0,
    );
    insertArt.run(
      "art-clean",
      "mtg-nocal",
      "conferenceRecords/2",
      "recording",
      "df-5",
      "正常完了録画",
      "video/mp4",
      "https://drive.google.com/5",
      "2026-11-20T05:00:00.000Z",
      "2026-11-20T05:01:00.000Z",
      null,
      null,
      2,
    );

    const failed = await listFailedArtifacts(db);
    expect(failed.map((a) => a.id)).toEqual(["art-unattached-warn", "art-unshared-err"]);

    const warnings = await listCompletedWarningArtifacts(db);
    expect(warnings.map((a) => a.id)).toEqual(["art-nocal-warn", "art-completed-warn"]);
  });

  it("listPendingArtifacts は取り消し済み会議と予定のない会議の未添付を毎時の再試行に含めない", async () => {
    const { raw, db } = createArtifactsDb();
    const insertMeeting = raw.prepare(
      "INSERT INTO meetings (id, title, calendar_event_id, status) VALUES (?, ?, ?, ?)",
    );
    insertMeeting.run("mtg-cal", "予定あり会議", "evt-1", "active");
    insertMeeting.run("mtg-nocal", "予定なし会議", null, "active");
    insertMeeting.run("mtg-canceled", "取り消し済み会議", "evt-2", "canceled");
    for (const meetingId of ["mtg-cal", "mtg-nocal", "mtg-canceled"]) {
      raw
        .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
        .run(`conferenceRecords/${meetingId}`, meetingId);
    }
    const insertArt = raw.prepare(
      `INSERT INTO artifacts (
         id, meeting_id, conference_record, kind, drive_file_id, title, mime_type,
         web_view_link, created_at, shared_at, attached_at, attempts
       ) VALUES (?, ?, ?, 'recording', ?, ?, 'video/mp4', 'https://drive.google.com/x', ?, ?, ?, ?)`,
    );
    const shared = "2026-11-20T00:30:00.000Z";
    const rows: [string, string, string | null, string | null, number][] = [
      ["cal-unshared", "mtg-cal", null, null, 0],
      ["cal-unattached", "mtg-cal", shared, null, 0],
      ["cal-done", "mtg-cal", shared, shared, 0],
      ["cal-exhausted", "mtg-cal", null, null, 20],
      ["nocal-unshared", "mtg-nocal", null, null, 0],
      ["nocal-unattached", "mtg-nocal", shared, null, 0],
      ["canceled-unshared", "mtg-canceled", null, null, 0],
      ["canceled-unattached", "mtg-canceled", shared, null, 0],
    ];
    rows.forEach(([id, meetingId, sharedAt, attachedAt, attempts], idx) => {
      insertArt.run(
        id,
        meetingId,
        `conferenceRecords/${meetingId}`,
        `df-${id}`,
        id,
        `2026-11-20T0${idx}:00:00.000Z`,
        sharedAt,
        attachedAt,
        attempts,
      );
    });

    const pending = await listPendingArtifacts(db, 20);
    expect(pending.map((a) => a.id)).toEqual(["cal-unshared", "cal-unattached", "nocal-unshared"]);
  });

  it("artifact_share_failures の upsert・会議単位取得・メール指定削除が動作する", async () => {
    const { raw, db } = createArtifactsDb();
    raw
      .prepare("INSERT INTO meetings (id, title, calendar_event_id) VALUES (?, ?, ?)")
      .run("mtg-1", "会議1", "evt-1");
    raw
      .prepare("INSERT INTO conference_records (name, meeting_id) VALUES (?, ?)")
      .run("conferenceRecords/1", "mtg-1");
    raw
      .prepare(
        `INSERT INTO artifacts (
           id, meeting_id, conference_record, kind, drive_file_id, title, mime_type,
           web_view_link, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "art-1",
        "mtg-1",
        "conferenceRecords/1",
        "recording",
        "df-1",
        "録画",
        "video/mp4",
        "https://drive.google.com/1",
        "2026-11-20T00:00:00.000Z",
      );

    await upsertArtifactShareFailure(db, {
      artifactId: "art-1",
      emailNormalized: "bad@example.com",
      httpStatus: 400,
      apiStatus: "invalidSharingRequest",
      failedAt: "2026-11-20T01:00:00.000Z",
    });
    await upsertArtifactShareFailure(db, {
      artifactId: "art-1",
      emailNormalized: "other@example.com",
      httpStatus: 403,
      apiStatus: "PERMISSION_DENIED",
      failedAt: "2026-11-20T01:00:00.000Z",
    });

    expect(await listMeetingArtifactShareFailures(db, "mtg-1")).toEqual([
      {
        artifactId: "art-1",
        artifactKind: "recording",
        artifactTitle: "録画",
        emailNormalized: "bad@example.com",
        httpStatus: 400,
        apiStatus: "invalidSharingRequest",
        failedAt: "2026-11-20T01:00:00.000Z",
      },
      {
        artifactId: "art-1",
        artifactKind: "recording",
        artifactTitle: "録画",
        emailNormalized: "other@example.com",
        httpStatus: 403,
        apiStatus: "PERMISSION_DENIED",
        failedAt: "2026-11-20T01:00:00.000Z",
      },
    ]);

    await deleteArtifactShareFailuresForEmails(db, "art-1", ["other@example.com"]);
    expect(await listArtifactShareFailureEmails(db, "art-1")).toEqual(["bad@example.com"]);
  });

  it("upsertConferenceRecord は既存の stats_status や集計列をリセットしない", async () => {
    const { raw, db } = createArtifactsDb();
    raw
      .prepare("INSERT INTO meetings (id, title, calendar_event_id) VALUES (?, ?, ?)")
      .run("mtg-1", "会議1", "evt-1");
    raw
      .prepare(
        `INSERT INTO conference_records (
           name, meeting_id, start_time, end_time, expire_time, stats_status, participant_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "conferenceRecords/cr-1",
        "mtg-1",
        "2026-11-19T10:00:00Z",
        "2026-11-19T11:00:00Z",
        null,
        "collected",
        5,
      );

    await upsertConferenceRecord(db, {
      name: "conferenceRecords/cr-1",
      meetingId: "mtg-1",
      startTime: "2026-11-19T10:00:00Z",
      endTime: "2026-11-19T11:00:00Z",
      expireTime: "2026-12-19T11:00:00Z",
    });

    const row = raw
      .prepare(
        "SELECT expire_time, stats_status, participant_count FROM conference_records WHERE name = ?",
      )
      .get("conferenceRecords/cr-1") as {
      expire_time: string;
      stats_status: string;
      participant_count: number;
    };
    expect(row).toEqual({
      expire_time: "2026-12-19T11:00:00Z",
      stats_status: "collected",
      participant_count: 5,
    });
  });
});
