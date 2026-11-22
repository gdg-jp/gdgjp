import type { MeetingInviteeRecord } from "~/features/meetings/meeting";
import { maskEmail } from "~/lib/redact-email";
import type {
  ConferenceParticipantCategory,
  ConferenceParticipantKind,
  ConferenceParticipantStatRow,
  ConferenceStatsStatus,
  ConferenceStatsView,
  TranscriptStatsStatus,
} from "./stats";

type ConferenceStatsSummaryDbRow = {
  name: string;
  start_time: string | null;
  end_time: string | null;
  stats_status: Exclude<ConferenceStatsStatus, "skipped">;
  participant_count: number | null;
  invitee_attended_count: number | null;
  peak_concurrent: number | null;
  total_attendance_seconds: number | null;
};

type BreakdownDbRow = {
  conference_record: string;
  non_invitee_count: number;
  anonymous_count: number;
  phone_count: number;
};

type TranscriptStatusDbRow = {
  conference_record: string;
  status: TranscriptStatsStatus;
};

type ParticipantViewerDbRow = {
  name: string;
  conference_record: string;
  kind: ConferenceParticipantKind;
  display_name: string | null;
  invitee_email_normalized: string | null;
  earliest_start_time: string | null;
  latest_end_time: string | null;
  session_count: number;
  total_seconds: number;
};

type SpeakerStatsViewerDbRow = {
  conference_record: string;
  participant: string;
  speaking_seconds: number;
};

function summarizeTranscriptStatus(
  statuses: readonly TranscriptStatsStatus[],
): TranscriptStatsStatus | "none" {
  if (statuses.length === 0) return "none";
  if (statuses.some((s) => s === "collected")) return "collected";
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.some((s) => s === "failed")) return "failed";
  return "expired";
}

function resolveParticipantCategory(
  row: ParticipantViewerDbRow,
  inviteeByEmail: ReadonlyMap<string, MeetingInviteeRecord>,
): ConferenceParticipantCategory {
  if (row.invitee_email_normalized) {
    const inv = inviteeByEmail.get(row.invitee_email_normalized);
    return inv?.role === "cohost" ? "cohost" : "invitee";
  }
  if (row.kind === "anonymous") return "anonymous";
  if (row.kind === "phone") return "phone";
  return "non_invitee";
}

function buildParticipantRows(
  conferenceRecord: string,
  participantRows: readonly ParticipantViewerDbRow[],
  speakerSecondsByParticipant: ReadonlyMap<string, number>,
  hasCollectedTranscript: boolean,
  invitees: readonly MeetingInviteeRecord[],
  inviteeByEmail: ReadonlyMap<string, MeetingInviteeRecord>,
): ConferenceParticipantStatRow[] {
  const attendedEmails = new Set<string>();
  const rows: ConferenceParticipantStatRow[] = [];

  for (const row of participantRows) {
    const invitee = row.invitee_email_normalized
      ? inviteeByEmail.get(row.invitee_email_normalized)
      : undefined;
    if (invitee) {
      attendedEmails.add(invitee.emailNormalized);
    }

    const displayName = invitee?.displayName ?? row.display_name ?? null;
    const maskedEmail = invitee ? maskEmail(invitee.email) : null;
    const speaking = speakerSecondsByParticipant.get(row.name);

    rows.push({
      key: `${conferenceRecord}:${row.name}`,
      displayName,
      maskedEmail,
      category: resolveParticipantCategory(row, inviteeByEmail),
      attended: true,
      earliestStartTime: row.earliest_start_time,
      latestEndTime: row.latest_end_time,
      totalSeconds: Number(row.total_seconds),
      sessionCount: Number(row.session_count),
      speakingSeconds: speaking !== undefined ? speaking : hasCollectedTranscript ? 0 : null,
    });
  }

  let absentIndex = 0;
  for (const invitee of invitees) {
    if (attendedEmails.has(invitee.emailNormalized)) continue;
    rows.push({
      key: `${conferenceRecord}:absent:${absentIndex++}`,
      displayName: invitee.displayName,
      maskedEmail: maskEmail(invitee.email),
      category: invitee.role === "cohost" ? "cohost" : "invitee",
      attended: false,
      earliestStartTime: null,
      latestEndTime: null,
      totalSeconds: 0,
      sessionCount: 0,
      speakingSeconds: null,
    });
  }

  return rows;
}

/**
 * 会議詳細画面向けに D1 のみから開催回別の参加統計を取得する（Google API は一切呼ばない）。
 * `includeParticipants` が `false`（一般参加者）の場合、個人別テーブル行は一切取得・返却しない。
 */
export async function getMeetingStatsForViewer(
  db: D1Database,
  params: {
    meetingId: string;
    invitees: readonly MeetingInviteeRecord[];
    includeParticipants: boolean;
  },
): Promise<ConferenceStatsView[]> {
  const recordsResult = await db
    .prepare(
      `SELECT name, start_time, end_time, stats_status, participant_count,
              invitee_attended_count, peak_concurrent, total_attendance_seconds
       FROM conference_records
       WHERE meeting_id = ? AND stats_status != 'skipped'
       ORDER BY COALESCE(start_time, '') DESC, name DESC`,
    )
    .bind(params.meetingId)
    .all<ConferenceStatsSummaryDbRow>();

  const records = recordsResult.results ?? [];
  if (records.length === 0) return [];

  const [breakdownResult, transcriptResult] = await Promise.all([
    db
      .prepare(
        `SELECT conference_record,
                SUM(CASE WHEN kind = 'signedin' AND invitee_email_normalized IS NULL THEN 1 ELSE 0 END) AS non_invitee_count,
                SUM(CASE WHEN kind = 'anonymous' THEN 1 ELSE 0 END) AS anonymous_count,
                SUM(CASE WHEN kind = 'phone' THEN 1 ELSE 0 END) AS phone_count
         FROM conference_participants
         WHERE meeting_id = ? AND is_host_account = 0
         GROUP BY conference_record`,
      )
      .bind(params.meetingId)
      .all<BreakdownDbRow>(),
    db
      .prepare(
        `SELECT ts.conference_record, ts.status
         FROM conference_transcript_stats ts
         INNER JOIN conference_records cr ON cr.name = ts.conference_record
         WHERE cr.meeting_id = ?`,
      )
      .bind(params.meetingId)
      .all<TranscriptStatusDbRow>(),
  ]);

  const breakdownByRecord = new Map<string, BreakdownDbRow>();
  for (const row of breakdownResult.results ?? []) {
    breakdownByRecord.set(row.conference_record, row);
  }

  const transcriptStatusesByRecord = new Map<string, TranscriptStatsStatus[]>();
  for (const row of transcriptResult.results ?? []) {
    const list = transcriptStatusesByRecord.get(row.conference_record) ?? [];
    list.push(row.status);
    transcriptStatusesByRecord.set(row.conference_record, list);
  }

  const participantsByRecord = new Map<string, ParticipantViewerDbRow[]>();
  const speakerSecondsByRecord = new Map<string, Map<string, number>>();
  const inviteeByEmail = new Map(params.invitees.map((inv) => [inv.emailNormalized, inv]));

  if (params.includeParticipants) {
    const [participantsResult, speakerResult] = await Promise.all([
      db
        .prepare(
          `SELECT name, conference_record, kind, display_name, invitee_email_normalized,
                  earliest_start_time, latest_end_time, session_count, total_seconds
           FROM conference_participants
           WHERE meeting_id = ? AND is_host_account = 0
           ORDER BY COALESCE(earliest_start_time, '') ASC, name ASC`,
        )
        .bind(params.meetingId)
        .all<ParticipantViewerDbRow>(),
      db
        .prepare(
          `SELECT ts.conference_record, ss.participant, SUM(ss.speaking_seconds) AS speaking_seconds
           FROM conference_speaker_stats ss
           INNER JOIN conference_transcript_stats ts ON ts.transcript = ss.transcript
           INNER JOIN conference_records cr ON cr.name = ts.conference_record
           WHERE cr.meeting_id = ?
           GROUP BY ts.conference_record, ss.participant`,
        )
        .bind(params.meetingId)
        .all<SpeakerStatsViewerDbRow>(),
    ]);

    for (const row of participantsResult.results ?? []) {
      const list = participantsByRecord.get(row.conference_record) ?? [];
      list.push(row);
      participantsByRecord.set(row.conference_record, list);
    }

    for (const row of speakerResult.results ?? []) {
      let map = speakerSecondsByRecord.get(row.conference_record);
      if (!map) {
        map = new Map<string, number>();
        speakerSecondsByRecord.set(row.conference_record, map);
      }
      map.set(row.participant, Number(row.speaking_seconds));
    }
  }

  return records.map((record) => {
    const breakdown = breakdownByRecord.get(record.name);
    const transcriptStatus = summarizeTranscriptStatus(
      transcriptStatusesByRecord.get(record.name) ?? [],
    );
    const isCollected = record.stats_status === "collected";

    const participants = params.includeParticipants
      ? isCollected
        ? buildParticipantRows(
            record.name,
            participantsByRecord.get(record.name) ?? [],
            speakerSecondsByRecord.get(record.name) ?? new Map(),
            transcriptStatus === "collected",
            params.invitees,
            inviteeByEmail,
          )
        : []
      : null;

    return {
      name: record.name,
      startTime: record.start_time,
      endTime: record.end_time,
      statsStatus: record.stats_status,
      participantCount: record.participant_count === null ? null : Number(record.participant_count),
      inviteeAttendedCount:
        record.invitee_attended_count === null ? null : Number(record.invitee_attended_count),
      totalInviteeCount: params.invitees.length,
      peakConcurrent: record.peak_concurrent === null ? null : Number(record.peak_concurrent),
      totalAttendanceSeconds:
        record.total_attendance_seconds === null ? null : Number(record.total_attendance_seconds),
      nonInviteeCount: isCollected ? Number(breakdown?.non_invitee_count ?? 0) : null,
      anonymousCount: isCollected ? Number(breakdown?.anonymous_count ?? 0) : null,
      phoneCount: isCollected ? Number(breakdown?.phone_count ?? 0) : null,
      transcriptStatsStatus: transcriptStatus,
      participants,
    };
  });
}
