import { DEFAULT_TIME_ZONE, isValidTimeZone } from "~/features/meetings/meeting";

export type ConferenceStatsStatus =
  | "pending"
  | "collecting"
  | "collected"
  | "skipped"
  | "failed"
  | "expired";

export type TranscriptStatsStatus = "pending" | "collected" | "failed" | "expired";

export type ConferenceParticipantKind = "signedin" | "anonymous" | "phone";

export type ConferenceParticipantCategory =
  | "cohost"
  | "invitee"
  | "non_invitee"
  | "anonymous"
  | "phone";

export type ConferenceParticipantStatRow = {
  key: string;
  displayName: string | null;
  maskedEmail: string | null;
  category: ConferenceParticipantCategory;
  attended: boolean;
  earliestStartTime: string | null;
  latestEndTime: string | null;
  totalSeconds: number;
  sessionCount: number;
  speakingSeconds: number | null;
};

export type ConferenceStatsView = {
  name: string;
  startTime: string | null;
  endTime: string | null;
  statsStatus: Exclude<ConferenceStatsStatus, "skipped">;
  participantCount: number | null;
  inviteeAttendedCount: number | null;
  totalInviteeCount: number;
  peakConcurrent: number | null;
  totalAttendanceSeconds: number | null;
  nonInviteeCount: number | null;
  anonymousCount: number | null;
  phoneCount: number | null;
  transcriptStatsStatus: TranscriptStatsStatus | "none";
  participants: ConferenceParticipantStatRow[] | null;
};

export function formatDurationJa(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const rounded = Math.round(seconds);
  if (rounded < 60) {
    return `${rounded}秒`;
  }
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
  }
  return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分`;
}

export function formatStatsDateTime(iso: string | null, timeZone = DEFAULT_TIME_ZONE): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).format(date);
}

export function formatStatsTime(iso: string | null, timeZone = DEFAULT_TIME_ZONE): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).format(date);
}

export function formatConferencePeriod(
  startIso: string | null,
  endIso: string | null,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const startLabel = formatStatsDateTime(startIso, timeZone);
  if (!startIso && !endIso) {
    return "開催時刻未記録";
  }
  if (!endIso) {
    return `${startLabel}〜`;
  }
  const startMs = startIso ? Date.parse(startIso) : Number.NaN;
  const endMs = Date.parse(endIso);
  const endLabel = formatStatsDateTime(endIso, timeZone);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
    const durationSec = Math.round((endMs - startMs) / 1000);
    return `${startLabel}〜${endLabel}（${formatDurationJa(durationSec)}）`;
  }
  return `${startLabel}〜${endLabel}`;
}
