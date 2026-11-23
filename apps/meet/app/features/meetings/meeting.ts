export type MeetingStatus = "creating" | "active" | "failed" | "canceled";

export type MeetingAccessType = "RESTRICTED" | "TRUSTED" | "OPEN";

export type InviteeRole = "cohost" | "participant";

export type InviteSourceKind =
  | "host_chapter_organizers"
  | "chapter_organizers"
  | "chapter_all"
  | "email";

export type InviteeSourceKind = "creator" | InviteSourceKind;

export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export const TIME_ZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Asia/Tokyo", label: "Asia/Tokyo（日本標準時 JST）" },
  { value: "UTC", label: "UTC（協定世界時）" },
  { value: "Asia/Singapore", label: "Asia/Singapore（SGT）" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles（PT）" },
  { value: "America/New_York", label: "America/New_York（ET）" },
  { value: "Europe/London", label: "Europe/London（UK）" },
];

export const MEETING_STATUS_META: Record<
  MeetingStatus,
  { label: string; tone: "info" | "success" | "danger" | "neutral" }
> = {
  creating: { label: "作成中", tone: "info" },
  active: { label: "有効", tone: "success" },
  failed: { label: "作成失敗", tone: "danger" },
  canceled: { label: "取り消し済み", tone: "neutral" },
};

export const MEETING_ACCESS_TYPE_OPTIONS: ReadonlyArray<{
  value: MeetingAccessType;
  label: string;
  description: string;
}> = [
  {
    value: "RESTRICTED",
    label: "制限付き（招待者のみ）",
    description: "招待された人のみノックなしで入室できます（既定）。",
  },
  {
    value: "TRUSTED",
    label: "信頼済み（組織内 + 招待者）",
    description: "gdgoc.jp 組織内アカウントと招待された人がノックなしで入室できます。",
  },
  {
    value: "OPEN",
    label: "公開（リンクを知っている全員）",
    description: "Meet リンクを知っている全員がノックなしで入室できます。",
  },
];

export type MeetingAutoArtifacts = {
  autoTranscription: boolean;
  autoSmartNotes: boolean;
  autoRecording: boolean;
};

export const DEFAULT_MEETING_AUTO_ARTIFACTS: Readonly<MeetingAutoArtifacts> = {
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
};

export const MEETING_AUTO_ARTIFACT_OPTIONS: ReadonlyArray<{
  key: keyof MeetingAutoArtifacts;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    key: "autoTranscription",
    label: "文字起こし（自動開始）",
    shortLabel: "文字起こし",
    description:
      "権限のある参加者が入室すると文字起こしを自動で開始し、Google ドキュメントとして保存します。",
  },
  {
    key: "autoSmartNotes",
    label: "Gemini Notes（自動開始）",
    shortLabel: "Gemini Notes",
    description:
      "権限のある参加者が入室すると Gemini によるメモ作成を自動で開始し、議事録を保存します。",
  },
  {
    key: "autoRecording",
    label: "録画・チャット保存（自動開始）",
    shortLabel: "録画・チャット保存",
    description: "Google ドライブの容量消費を抑えるため、必要な会議のみオンにしてください。",
  },
];

export type MeetingRecord = {
  id: string;
  hostChapterId: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  accessType: MeetingAccessType;
  autoTranscription: boolean;
  autoSmartNotes: boolean;
  autoRecording: boolean;
  spaceName: string | null;
  meetingUri: string | null;
  meetingCode: string | null;
  calendarEventId: string | null;
  calendarHtmlLink: string | null;
  status: MeetingStatus;
  lastError: string | null;
  createdByUserId: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  canceledAt: string | null;
};

export type MeetingInviteSourceRecord = {
  id: string;
  meetingId: string;
  kind: InviteSourceKind;
  chapterId: number | null;
  email: string | null;
  role: InviteeRole;
  createdAt: string;
};

export type MeetingInviteeRecord = {
  meetingId: string;
  emailNormalized: string;
  email: string;
  displayName: string | null;
  userId: string | null;
  role: InviteeRole;
  sourceKinds: InviteeSourceKind[];
  googleUser?: string | null;
};

export type MeetingListItem = {
  id: string;
  hostChapterId: number;
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  accessType: MeetingAccessType;
  meetingUri: string | null;
  status: MeetingStatus;
  isCreator: boolean;
  myRole: InviteeRole | null;
};

export type PublicInvitee = {
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
  role: InviteeRole;
  isCreator: boolean;
  isChapterDerived: boolean;
};

export type InviteePreviewCounts = {
  creatorCount: number;
  hostChapterCount: number;
  otherChaptersCount: number;
  emailCount: number;
  totalCount: number;
  cohostCount: number;
  participantCount: number;
  exceedsMaxInvitees: boolean;
  exceedsMaxCohosts: boolean;
};

export function isMeetingAccessType(value: string): value is MeetingAccessType {
  return value === "RESTRICTED" || value === "TRUSTED" || value === "OPEN";
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getZonedParts(
  utcMs: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

export function localDateTimeToUtcIso(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): string | null {
  if (!isValidTimeZone(timeZone)) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr.trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidateUtc = wallAsUtc;

  for (let i = 0; i < 2; i++) {
    const zoned = getZonedParts(candidateUtc, timeZone);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    const offsetMs = zonedAsUtc - candidateUtc;
    candidateUtc = wallAsUtc - offsetMs;
  }

  return new Date(candidateUtc).toISOString();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function utcIsoToLocalDateTime(
  iso: string,
  timeZone: string,
): { date: string; time: string } {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return { date: "", time: "" };
  }
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = getZonedParts(parsed.getTime(), tz);
  return {
    date: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
    time: `${pad2(parts.hour)}:${pad2(parts.minute)}`,
  };
}

export function getDefaultMeetingSchedule(
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): { date: string; startTime: string; endTime: string } {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const nextHourUtc = Math.ceil(now.getTime() / 3_600_000) * 3_600_000;
  const startParts = getZonedParts(nextHourUtc, tz);
  const endParts = getZonedParts(nextHourUtc + 3_600_000, tz);

  if (
    startParts.year !== endParts.year ||
    startParts.month !== endParts.month ||
    startParts.day !== endParts.day
  ) {
    return {
      date: `${startParts.year}-${pad2(startParts.month)}-${pad2(startParts.day)}`,
      startTime: "22:00",
      endTime: "23:00",
    };
  }

  return {
    date: `${startParts.year}-${pad2(startParts.month)}-${pad2(startParts.day)}`,
    startTime: `${pad2(startParts.hour)}:${pad2(startParts.minute)}`,
    endTime: `${pad2(endParts.hour)}:${pad2(endParts.minute)}`,
  };
}

export function formatMeetingDateTimeRange(
  startAtIso: string,
  endAtIso: string,
  timeZone: string,
): string {
  const start = new Date(startAtIso);
  const end = new Date(endAtIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startAtIso} - ${endAtIso}`;
  }
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const dateFmt = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: tz,
  });
  const timeFmt = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  });
  const startDate = dateFmt.format(start);
  const endDate = dateFmt.format(end);
  if (startDate === endDate) {
    return `${startDate} ${timeFmt.format(start)}〜${timeFmt.format(end)}`;
  }
  return `${startDate} ${timeFmt.format(start)}〜${endDate} ${timeFmt.format(end)}`;
}

export function splitMeetingsByTime<T extends { startAt: string; endAt: string }>(
  meetings: readonly T[],
  nowIso = new Date().toISOString(),
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const meeting of meetings) {
    if (meeting.endAt >= nowIso) {
      upcoming.push(meeting);
    } else {
      past.push(meeting);
    }
  }
  upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));
  past.sort((a, b) => b.startAt.localeCompare(a.startAt));
  return { upcoming, past };
}
