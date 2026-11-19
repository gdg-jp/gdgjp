/** 会議のステータス。 */
export type MeetingStatus = "creating" | "active" | "failed" | "canceled";

/** Meet スペースのアクセス種別。 */
export type MeetingAccessType = "RESTRICTED" | "TRUSTED" | "OPEN";

/** 会議における招待者の役割。 */
export type InviteeRole = "cohost" | "participant";

/** 招待元の種別（再同期の元データとして D1 に保存）。 */
export type InviteSourceKind =
  | "host_chapter_organizers"
  | "chapter_organizers"
  | "chapter_all"
  | "email";

/** 解決済み招待者の由来種別（作成者自身を含む）。 */
export type InviteeSourceKind = "creator" | InviteSourceKind;

/** 既定のタイムゾーン。 */
export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

/** フォームで選択しやすい主なタイムゾーン一覧。 */
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

export type MeetingRecord = {
  id: string;
  hostChapterId: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  accessType: MeetingAccessType;
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

/**
 * ブラウザへ返却する招待者情報。
 * チャプター由来の招待者には `email` キーを含めない。
 */
export type PublicInvitee = {
  displayName: string | null;
  role: InviteeRole;
  isCreator: boolean;
  isChapterDerived: boolean;
  email?: string;
};

/**
 * 作成前の招待者数プレビュー（人数のみ）。
 * ブラウザへチャプターメンバーの氏名・メールアドレスは返さない。
 */
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

/**
 * 指定タイムゾーンのローカル日時（`YYYY-MM-DD`, `HH:MM`）を UTC ISO 8601 文字列へ変換する。
 * 不正な日付・時刻・タイムゾーンの場合は `null` を返す。
 */
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

  // 2/31 などの存在しないカレンダー日付を検出する。
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

  // 夏時間境界を含め 2 回反復してタイムゾーンオフセットを収束させる。
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

/** 作成フォームの初期値となる日付・開始時刻・終了時刻（次の正時から 1 時間）を返す。 */
export function getDefaultMeetingSchedule(
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): { date: string; startTime: string; endTime: string } {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const nextHourUtc = Math.ceil(now.getTime() / 3_600_000) * 3_600_000;
  const startParts = getZonedParts(nextHourUtc, tz);
  const endParts = getZonedParts(nextHourUtc + 3_600_000, tz);

  // 23:00 → 00:00 のように日付をまたぐ場合は 22:00〜23:00 に丸め、同日フォームでそのまま送信できるようにする。
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

/** 会議の開始・終了時刻を指定タイムゾーンの日本語表記へ整形する。 */
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

/** 会議一覧を「今後の会議（終了前・昇順）」と「過去の会議（終了済み・降順）」へ分ける。 */
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
