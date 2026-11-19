import type {
  ArtifactKind,
  ArtifactRecord,
  ConferenceRecord,
  FailedArtifactItem,
} from "./artifact";

type ConferenceRecordRow = {
  name: string;
  meeting_id: string;
  start_time: string | null;
  end_time: string | null;
};

type ArtifactRow = {
  id: string;
  meeting_id: string;
  conference_record: string;
  kind: ArtifactKind;
  drive_file_id: string;
  title: string;
  mime_type: string;
  web_view_link: string;
  created_at: string;
  shared_at: string | null;
  attached_at: string | null;
  last_error: string | null;
  attempts: number;
};

type FailedArtifactRow = ArtifactRow & {
  meeting_title: string;
};

function mapConferenceRecordRow(row: ConferenceRecordRow): ConferenceRecord {
  return {
    name: row.name,
    meetingId: row.meeting_id,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

function mapArtifactRow(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    conferenceRecord: row.conference_record,
    kind: row.kind,
    driveFileId: row.drive_file_id,
    title: row.title,
    mimeType: row.mime_type,
    webViewLink: row.web_view_link,
    createdAt: row.created_at,
    sharedAt: row.shared_at,
    attachedAt: row.attached_at,
    lastError: row.last_error,
    attempts: Number(row.attempts),
  };
}

export async function getConferenceRecordByName(
  db: D1Database,
  name: string,
): Promise<ConferenceRecord | null> {
  const row = await db
    .prepare("SELECT name, meeting_id, start_time, end_time FROM conference_records WHERE name = ?")
    .bind(name)
    .first<ConferenceRecordRow>();
  return row ? mapConferenceRecordRow(row) : null;
}

export async function upsertConferenceRecord(
  db: D1Database,
  input: {
    name: string;
    meetingId: string;
    startTime: string | null;
    endTime: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO conference_records (name, meeting_id, start_time, end_time)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET
         start_time = COALESCE(excluded.start_time, conference_records.start_time),
         end_time = COALESCE(excluded.end_time, conference_records.end_time)`,
    )
    .bind(input.name, input.meetingId, input.startTime, input.endTime)
    .run();
}

export type UpsertArtifactInput = {
  id: string;
  meetingId: string;
  conferenceRecord: string;
  kind: ArtifactKind;
  driveFileId: string;
  title: string;
  mimeType: string;
  webViewLink: string;
  createdAt: string;
};

/**
 * `artifacts` を `drive_file_id` 一意制約で upsert し、保存後の実レコードを返す。
 * 文字起こしと Gemini メモが同一ドキュメント ID を返す場合でも 1 行に統合される。
 */
export async function upsertArtifact(
  db: D1Database,
  input: UpsertArtifactInput,
): Promise<ArtifactRecord> {
  await db
    .prepare(
      `INSERT INTO artifacts (
         id, meeting_id, conference_record, kind, drive_file_id,
         title, mime_type, web_view_link, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (drive_file_id) DO UPDATE SET
         title = excluded.title,
         web_view_link = excluded.web_view_link`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.conferenceRecord,
      input.kind,
      input.driveFileId,
      input.title,
      input.mimeType,
      input.webViewLink,
      input.createdAt,
    )
    .run();

  const saved = await getArtifactByDriveFileId(db, input.driveFileId);
  if (!saved) {
    throw new Error(`artifact の保存結果を取得できませんでした (${input.driveFileId})`);
  }
  return saved;
}

export async function getArtifactById(
  db: D1Database,
  artifactId: string,
): Promise<ArtifactRecord | null> {
  const row = await db
    .prepare("SELECT * FROM artifacts WHERE id = ?")
    .bind(artifactId)
    .first<ArtifactRow>();
  return row ? mapArtifactRow(row) : null;
}

export async function getArtifactByDriveFileId(
  db: D1Database,
  driveFileId: string,
): Promise<ArtifactRecord | null> {
  const row = await db
    .prepare("SELECT * FROM artifacts WHERE drive_file_id = ?")
    .bind(driveFileId)
    .first<ArtifactRow>();
  return row ? mapArtifactRow(row) : null;
}

export async function listArtifactsByMeetingId(
  db: D1Database,
  meetingId: string,
): Promise<ArtifactRecord[]> {
  const result = await db
    .prepare("SELECT * FROM artifacts WHERE meeting_id = ? ORDER BY created_at ASC, id ASC")
    .bind(meetingId)
    .all<ArtifactRow>();
  return (result.results ?? []).map(mapArtifactRow);
}

/**
 * 未共有または未添付で、再試行上限未満の artifact 一覧を返す（毎時 cron 用）。
 * `share_artifact` が何もしない取り消し済み会議と、添付先の予定がない会議の未添付は除外する
 * （除外しないと毎時同じジョブを投入し続ける）。
 */
export async function listPendingArtifacts(
  db: D1Database,
  maxAttempts = 20,
): Promise<ArtifactRecord[]> {
  const result = await db
    .prepare(
      `SELECT a.* FROM artifacts a
       INNER JOIN meetings m ON m.id = a.meeting_id
       WHERE m.status = 'active'
         AND (a.shared_at IS NULL OR (a.attached_at IS NULL AND m.calendar_event_id IS NOT NULL))
         AND a.attempts < ?
       ORDER BY a.created_at ASC, a.id ASC`,
    )
    .bind(maxAttempts)
    .all<ArtifactRow>();
  return (result.results ?? []).map(mapArtifactRow);
}

/** 管理画面向けの失敗・未完了 artifact 一覧を返す。 */
export async function listFailedArtifacts(
  db: D1Database,
  limit = 50,
): Promise<FailedArtifactItem[]> {
  const result = await db
    .prepare(
      `SELECT a.*, m.title AS meeting_title
       FROM artifacts a
       INNER JOIN meetings m ON m.id = a.meeting_id
       WHERE a.last_error IS NOT NULL
          OR (a.attempts > 0 AND (a.shared_at IS NULL OR a.attached_at IS NULL))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<FailedArtifactRow>();
  return (result.results ?? []).map((row) => ({
    ...mapArtifactRow(row),
    meetingTitle: row.meeting_title,
  }));
}

export async function markArtifactShared(
  db: D1Database,
  artifactId: string,
  sharedAt: string,
  lastError: string | null,
): Promise<void> {
  await db
    .prepare("UPDATE artifacts SET shared_at = ?, last_error = ? WHERE id = ?")
    .bind(sharedAt, lastError, artifactId)
    .run();
}

export async function markArtifactAttached(
  db: D1Database,
  artifactId: string,
  attachedAt: string,
): Promise<void> {
  await db
    .prepare("UPDATE artifacts SET attached_at = ? WHERE id = ?")
    .bind(attachedAt, artifactId)
    .run();
}

export async function recordArtifactAttemptError(
  db: D1Database,
  artifactId: string,
  lastError: string,
): Promise<void> {
  await db
    .prepare("UPDATE artifacts SET attempts = attempts + 1, last_error = ? WHERE id = ?")
    .bind(lastError, artifactId)
    .run();
}

export async function resetArtifactForRetry(db: D1Database, artifactId: string): Promise<void> {
  await db
    .prepare("UPDATE artifacts SET attempts = 0, last_error = NULL WHERE id = ?")
    .bind(artifactId)
    .run();
}
