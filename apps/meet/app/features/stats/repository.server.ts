import type { ConferenceAggregationResult } from "./aggregate";
import type { ConferenceParticipantKind, ConferenceStatsStatus } from "./stats";

export {
  type TranscriptStatsRecord,
  ensureTranscriptStatsPending,
  expireStaleConferenceStats,
  expireStaleTranscriptStats,
  getTranscriptStats,
  incrementTranscriptStatsAttempts,
  listPendingConferenceStatsForCron,
  listPendingTranscriptStatsForCron,
  saveTranscriptStatsPageBatch,
  setTranscriptStatsTerminal,
} from "./transcript-repository.server";
export { getMeetingStatsForViewer } from "./viewer-repository.server";

const BATCH_CHUNK_SIZE = 50;

export type ConferenceStatsRecordRow = {
  name: string;
  meetingId: string;
  startTime: string | null;
  endTime: string | null;
  expireTime: string | null;
  statsStatus: ConferenceStatsStatus;
  statsAttempts: number;
  statsCollectedAt: string | null;
  statsLastError: string | null;
};

export type ConferenceParticipantRecord = {
  name: string;
  conferenceRecord: string;
  meetingId: string;
  kind: ConferenceParticipantKind;
  googleUser: string | null;
  displayName: string | null;
  isHostAccount: boolean;
  inviteeEmailNormalized: string | null;
  earliestStartTime: string | null;
  latestEndTime: string | null;
  sessionCount: number;
  totalSeconds: number;
};

export type ConferenceParticipantSessionRecord = {
  name: string;
  participant: string;
  startTime: string | null;
  endTime: string | null;
};

async function runBatched(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_CHUNK_SIZE));
  }
}

export async function getConferenceRecordForStats(
  db: D1Database,
  name: string,
): Promise<ConferenceStatsRecordRow | null> {
  const row = await db
    .prepare(
      `SELECT name, meeting_id, start_time, end_time, expire_time,
              stats_status, stats_attempts, stats_collected_at, stats_last_error
       FROM conference_records WHERE name = ?`,
    )
    .bind(name)
    .first<{
      name: string;
      meeting_id: string;
      start_time: string | null;
      end_time: string | null;
      expire_time: string | null;
      stats_status: ConferenceStatsStatus;
      stats_attempts: number;
      stats_collected_at: string | null;
      stats_last_error: string | null;
    }>();
  if (!row) return null;
  return {
    name: row.name,
    meetingId: row.meeting_id,
    startTime: row.start_time,
    endTime: row.end_time,
    expireTime: row.expire_time,
    statsStatus: row.stats_status,
    statsAttempts: Number(row.stats_attempts),
    statsCollectedAt: row.stats_collected_at,
    statsLastError: row.stats_last_error,
  };
}

export async function startConferenceStatsCollecting(db: D1Database, name: string): Promise<void> {
  await db
    .prepare(
      `UPDATE conference_records
       SET stats_status = 'collecting', stats_attempts = stats_attempts + 1
       WHERE name = ?`,
    )
    .bind(name)
    .run();
}

export async function updateConferenceRecordTimes(
  db: D1Database,
  name: string,
  times: { startTime: string | null; endTime: string | null; expireTime: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE conference_records
       SET start_time = COALESCE(?, start_time),
           end_time = COALESCE(?, end_time),
           expire_time = COALESCE(?, expire_time)
       WHERE name = ?`,
    )
    .bind(times.startTime, times.endTime, times.expireTime, name)
    .run();
}

export async function setConferenceStatsStatus(
  db: D1Database,
  name: string,
  status: ConferenceStatsStatus,
  lastError: string | null = null,
): Promise<void> {
  await db
    .prepare("UPDATE conference_records SET stats_status = ?, stats_last_error = ? WHERE name = ?")
    .bind(status, lastError, name)
    .run();
}

export async function upsertConferenceParticipants(
  db: D1Database,
  items: ReadonlyArray<{
    name: string;
    conferenceRecord: string;
    meetingId: string;
    kind: ConferenceParticipantKind;
    googleUser: string | null;
    displayName: string | null;
    isHostAccount: boolean;
    inviteeEmailNormalized: string | null;
    earliestStartTime: string | null;
    latestEndTime: string | null;
  }>,
): Promise<void> {
  if (items.length === 0) return;
  const statements = items.map((item) =>
    db
      .prepare(
        `INSERT INTO conference_participants (
           name, conference_record, meeting_id, kind, google_user, display_name,
           is_host_account, invitee_email_normalized, earliest_start_time, latest_end_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET
           kind = excluded.kind,
           google_user = excluded.google_user,
           display_name = excluded.display_name,
           is_host_account = excluded.is_host_account,
           invitee_email_normalized = COALESCE(excluded.invitee_email_normalized, conference_participants.invitee_email_normalized),
           earliest_start_time = excluded.earliest_start_time,
           latest_end_time = excluded.latest_end_time`,
      )
      .bind(
        item.name,
        item.conferenceRecord,
        item.meetingId,
        item.kind,
        item.googleUser,
        item.displayName,
        item.isHostAccount ? 1 : 0,
        item.inviteeEmailNormalized,
        item.earliestStartTime,
        item.latestEndTime,
      ),
  );
  await runBatched(db, statements);
}

export async function listConferenceParticipants(
  db: D1Database,
  conferenceRecord: string,
): Promise<ConferenceParticipantRecord[]> {
  const result = await db
    .prepare(
      `SELECT name, conference_record, meeting_id, kind, google_user, display_name,
              is_host_account, invitee_email_normalized, earliest_start_time, latest_end_time,
              session_count, total_seconds
       FROM conference_participants
       WHERE conference_record = ?
       ORDER BY name ASC`,
    )
    .bind(conferenceRecord)
    .all<{
      name: string;
      conference_record: string;
      meeting_id: string;
      kind: ConferenceParticipantKind;
      google_user: string | null;
      display_name: string | null;
      is_host_account: number;
      invitee_email_normalized: string | null;
      earliest_start_time: string | null;
      latest_end_time: string | null;
      session_count: number;
      total_seconds: number;
    }>();

  return (result.results ?? []).map((row) => ({
    name: row.name,
    conferenceRecord: row.conference_record,
    meetingId: row.meeting_id,
    kind: row.kind,
    googleUser: row.google_user,
    displayName: row.display_name,
    isHostAccount: Number(row.is_host_account) === 1,
    inviteeEmailNormalized: row.invitee_email_normalized,
    earliestStartTime: row.earliest_start_time,
    latestEndTime: row.latest_end_time,
    sessionCount: Number(row.session_count),
    totalSeconds: Number(row.total_seconds),
  }));
}

export async function upsertConferenceParticipantSessions(
  db: D1Database,
  participantName: string,
  sessions: ReadonlyArray<{ name: string; startTime: string | null; endTime: string | null }>,
): Promise<void> {
  if (sessions.length === 0) return;
  const statements = sessions.map((session) =>
    db
      .prepare(
        `INSERT INTO conference_participant_sessions (name, participant, start_time, end_time)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET
           start_time = excluded.start_time,
           end_time = excluded.end_time`,
      )
      .bind(session.name, participantName, session.startTime, session.endTime),
  );
  await runBatched(db, statements);
}

export async function listConferenceParticipantSessions(
  db: D1Database,
  conferenceRecord: string,
): Promise<ConferenceParticipantSessionRecord[]> {
  const result = await db
    .prepare(
      `SELECT s.name, s.participant, s.start_time, s.end_time
       FROM conference_participant_sessions s
       INNER JOIN conference_participants p ON p.name = s.participant
       WHERE p.conference_record = ?
       ORDER BY s.start_time ASC, s.name ASC`,
    )
    .bind(conferenceRecord)
    .all<{
      name: string;
      participant: string;
      start_time: string | null;
      end_time: string | null;
    }>();

  return (result.results ?? []).map((row) => ({
    name: row.name,
    participant: row.participant,
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

export async function saveConferenceStatsCollected(
  db: D1Database,
  conferenceRecord: string,
  aggregation: ConferenceAggregationResult,
  collectedAt: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    ...aggregation.participants.map((p) =>
      db
        .prepare(
          "UPDATE conference_participants SET session_count = ?, total_seconds = ? WHERE name = ?",
        )
        .bind(p.sessionCount, p.totalSeconds, p.name),
    ),
    db
      .prepare(
        `UPDATE conference_records
         SET stats_status = 'collected',
             stats_collected_at = ?,
             stats_last_error = NULL,
             participant_count = ?,
             invitee_attended_count = ?,
             peak_concurrent = ?,
             total_attendance_seconds = ?
         WHERE name = ?`,
      )
      .bind(
        collectedAt,
        aggregation.participantCount,
        aggregation.inviteeAttendedCount,
        aggregation.peakConcurrent,
        aggregation.totalAttendanceSeconds,
        conferenceRecord,
      ),
  ];
  await runBatched(db, statements);
}
