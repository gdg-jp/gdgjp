import type { SpeakerTranscriptDelta } from "./aggregate";
import type { TranscriptStatsStatus } from "./stats";

const BATCH_CHUNK_SIZE = 50;

export type TranscriptStatsRecord = {
  transcript: string;
  conferenceRecord: string;
  status: TranscriptStatsStatus;
  attempts: number;
  collectedAt: string | null;
  lastError: string | null;
};

async function runBatched(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_CHUNK_SIZE));
  }
}

export async function getTranscriptStats(
  db: D1Database,
  transcript: string,
): Promise<TranscriptStatsRecord | null> {
  const row = await db
    .prepare(
      `SELECT transcript, conference_record, status, attempts, collected_at, last_error
       FROM conference_transcript_stats WHERE transcript = ?`,
    )
    .bind(transcript)
    .first<{
      transcript: string;
      conference_record: string;
      status: TranscriptStatsStatus;
      attempts: number;
      collected_at: string | null;
      last_error: string | null;
    }>();
  if (!row) return null;
  return {
    transcript: row.transcript,
    conferenceRecord: row.conference_record,
    status: row.status,
    attempts: Number(row.attempts),
    collectedAt: row.collected_at,
    lastError: row.last_error,
  };
}

export async function ensureTranscriptStatsPending(
  db: D1Database,
  transcript: string,
  conferenceRecord: string,
): Promise<TranscriptStatsRecord> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO conference_transcript_stats (transcript, conference_record, status)
       VALUES (?, ?, 'pending')`,
    )
    .bind(transcript, conferenceRecord)
    .run();
  const row = await getTranscriptStats(db, transcript);
  if (!row) {
    throw new Error(`conference_transcript_stats の作成に失敗しました (${transcript})`);
  }
  return row;
}

export async function incrementTranscriptStatsAttempts(
  db: D1Database,
  transcript: string,
): Promise<void> {
  await db
    .prepare("UPDATE conference_transcript_stats SET attempts = attempts + 1 WHERE transcript = ?")
    .bind(transcript)
    .run();
}

export async function saveTranscriptStatsPageBatch(
  db: D1Database,
  params: {
    transcript: string;
    clearExisting: boolean;
    deltas: readonly SpeakerTranscriptDelta[];
    collectedAt?: string;
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (params.clearExisting) {
    statements.push(
      db
        .prepare("DELETE FROM conference_speaker_stats WHERE transcript = ?")
        .bind(params.transcript),
    );
  }
  for (const delta of params.deltas) {
    statements.push(
      db
        .prepare(
          `INSERT INTO conference_speaker_stats (
             transcript, participant, entry_count, char_count, speaking_seconds
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (transcript, participant) DO UPDATE SET
             entry_count = conference_speaker_stats.entry_count + excluded.entry_count,
             char_count = conference_speaker_stats.char_count + excluded.char_count,
             speaking_seconds = conference_speaker_stats.speaking_seconds + excluded.speaking_seconds`,
        )
        .bind(
          params.transcript,
          delta.participant,
          delta.entryCount,
          delta.charCount,
          delta.speakingSeconds,
        ),
    );
  }
  if (params.collectedAt) {
    statements.push(
      db
        .prepare(
          `UPDATE conference_transcript_stats
           SET status = 'collected', collected_at = ?, last_error = NULL
           WHERE transcript = ?`,
        )
        .bind(params.collectedAt, params.transcript),
    );
  }
  if (statements.length > 0) {
    await runBatched(db, statements);
  }
}

export async function setTranscriptStatsTerminal(
  db: D1Database,
  transcript: string,
  status: "failed" | "expired",
  lastError: string | null = null,
): Promise<void> {
  await db
    .prepare(
      "UPDATE conference_transcript_stats SET status = ?, last_error = ? WHERE transcript = ?",
    )
    .bind(status, lastError, transcript)
    .run();
}

export async function expireStaleConferenceStats(db: D1Database, nowIso: string): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE conference_records
       SET stats_status = 'expired'
       WHERE stats_status IN ('pending', 'collecting', 'failed')
         AND expire_time IS NOT NULL
         AND expire_time <= ?`,
    )
    .bind(nowIso)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export async function expireStaleTranscriptStats(db: D1Database, nowIso: string): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE conference_transcript_stats
       SET status = 'expired'
       WHERE status IN ('pending', 'failed')
         AND conference_record IN (
           SELECT name FROM conference_records
           WHERE expire_time IS NOT NULL AND expire_time <= ?
         )`,
    )
    .bind(nowIso)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export async function listPendingConferenceStatsForCron(
  db: D1Database,
  params: {
    endedBeforeIso: string;
    /** この時刻より前に終わったのに `collecting` のままの記録は、Queue の再試行切れで止まったとみなす。 */
    staleCollectingBeforeIso?: string;
    nowIso: string;
    maxAttempts?: number;
    limit?: number;
  },
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT name FROM conference_records
       WHERE end_time IS NOT NULL
         AND ((stats_status IN ('pending', 'failed') AND end_time < ?)
           OR (stats_status = 'collecting' AND end_time < ?))
         AND (expire_time IS NULL OR expire_time > ?)
         AND stats_attempts < ?
       ORDER BY end_time ASC
       LIMIT ?`,
    )
    .bind(
      params.endedBeforeIso,
      params.staleCollectingBeforeIso ?? "",
      params.nowIso,
      params.maxAttempts ?? 10,
      params.limit ?? 20,
    )
    .all<{ name: string }>();
  return (result.results ?? []).map((row) => row.name);
}

export async function listPendingTranscriptStatsForCron(
  db: D1Database,
  params: { nowIso: string; maxAttempts?: number; limit?: number },
): Promise<Array<{ transcript: string; conferenceRecord: string }>> {
  const result = await db
    .prepare(
      `SELECT ts.transcript, ts.conference_record
       FROM conference_transcript_stats ts
       INNER JOIN conference_records cr ON cr.name = ts.conference_record
       WHERE ts.status IN ('pending', 'failed')
         AND (cr.expire_time IS NULL OR cr.expire_time > ?)
         AND ts.attempts < ?
       ORDER BY ts.transcript ASC
       LIMIT ?`,
    )
    .bind(params.nowIso, params.maxAttempts ?? 10, params.limit ?? 20)
    .all<{ transcript: string; conference_record: string }>();
  return (result.results ?? []).map((row) => ({
    transcript: row.transcript,
    conferenceRecord: row.conference_record,
  }));
}
