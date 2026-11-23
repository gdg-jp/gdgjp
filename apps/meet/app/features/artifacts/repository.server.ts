import type {
  ArtifactKind,
  ArtifactRecord,
  ArtifactShareFailureRecord,
  ConferenceRecord,
  FailedArtifactItem,
} from "./artifact";

const SQL_EMAIL_CHUNK_SIZE = 50;

type ConferenceRecordRow = {
  name: string;
  meeting_id: string;
  start_time: string | null;
  end_time: string | null;
  expire_time?: string | null;
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
    expireTime: row.expire_time ?? null,
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
    expireTime?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO conference_records (name, meeting_id, start_time, end_time, expire_time)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET
         start_time = COALESCE(excluded.start_time, conference_records.start_time),
         end_time = COALESCE(excluded.end_time, conference_records.end_time),
         expire_time = COALESCE(excluded.expire_time, conference_records.expire_time)`,
    )
    .bind(input.name, input.meetingId, input.startTime, input.endTime, input.expireTime ?? null)
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

export async function listFailedArtifacts(
  db: D1Database,
  limit = 50,
): Promise<FailedArtifactItem[]> {
  const result = await db
    .prepare(
      `SELECT a.*, m.title AS meeting_title
       FROM artifacts a
       INNER JOIN meetings m ON m.id = a.meeting_id
       WHERE (a.shared_at IS NULL OR (a.attached_at IS NULL AND m.calendar_event_id IS NOT NULL))
         AND (a.last_error IS NOT NULL OR a.attempts > 0)
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

export async function listCompletedWarningArtifacts(
  db: D1Database,
  limit = 50,
): Promise<FailedArtifactItem[]> {
  const result = await db
    .prepare(
      `SELECT a.*, m.title AS meeting_title
       FROM artifacts a
       INNER JOIN meetings m ON m.id = a.meeting_id
       WHERE a.shared_at IS NOT NULL
         AND (a.attached_at IS NOT NULL OR m.calendar_event_id IS NULL)
         AND a.last_error IS NOT NULL
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

export async function upsertArtifactShareFailure(
  db: D1Database,
  input: {
    artifactId: string;
    emailNormalized: string;
    httpStatus: number;
    apiStatus: string | null;
    failedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO artifact_share_failures (
         artifact_id, email_normalized, http_status, api_status, failed_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (artifact_id, email_normalized) DO UPDATE SET
         http_status = excluded.http_status,
         api_status = excluded.api_status,
         failed_at = excluded.failed_at`,
    )
    .bind(
      input.artifactId,
      input.emailNormalized,
      input.httpStatus,
      input.apiStatus,
      input.failedAt,
    )
    .run();
}

export async function deleteArtifactShareFailuresForEmails(
  db: D1Database,
  artifactId: string,
  emailsNormalized: readonly string[],
): Promise<void> {
  const unique = [...new Set(emailsNormalized.filter(Boolean))];
  if (unique.length === 0) return;

  for (let offset = 0; offset < unique.length; offset += SQL_EMAIL_CHUNK_SIZE) {
    const chunk = unique.slice(offset, offset + SQL_EMAIL_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    await db
      .prepare(
        `DELETE FROM artifact_share_failures
         WHERE artifact_id = ? AND email_normalized IN (${placeholders})`,
      )
      .bind(artifactId, ...chunk)
      .run();
  }
}

export async function listArtifactShareFailureEmails(
  db: D1Database,
  artifactId: string,
): Promise<string[]> {
  const result = await db
    .prepare("SELECT email_normalized FROM artifact_share_failures WHERE artifact_id = ?")
    .bind(artifactId)
    .all<{ email_normalized: string }>();
  return (result.results ?? []).map((row) => row.email_normalized);
}

type ArtifactShareFailureJoinedRow = {
  artifact_id: string;
  artifact_kind: ArtifactKind;
  artifact_title: string;
  email_normalized: string;
  http_status: number;
  api_status: string | null;
  failed_at: string;
};

export async function listMeetingArtifactShareFailures(
  db: D1Database,
  meetingId: string,
): Promise<ArtifactShareFailureRecord[]> {
  const result = await db
    .prepare(
      `SELECT f.artifact_id, a.kind AS artifact_kind, a.title AS artifact_title,
              f.email_normalized, f.http_status, f.api_status, f.failed_at
       FROM artifact_share_failures f
       INNER JOIN artifacts a ON a.id = f.artifact_id
       WHERE a.meeting_id = ?
       ORDER BY f.email_normalized ASC, a.created_at ASC, a.id ASC`,
    )
    .bind(meetingId)
    .all<ArtifactShareFailureJoinedRow>();
  return (result.results ?? []).map((row) => ({
    artifactId: row.artifact_id,
    artifactKind: row.artifact_kind,
    artifactTitle: row.artifact_title,
    emailNormalized: row.email_normalized,
    httpStatus: Number(row.http_status),
    apiStatus: row.api_status,
    failedAt: row.failed_at,
  }));
}
