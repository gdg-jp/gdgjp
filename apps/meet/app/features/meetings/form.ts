import { type InviteSourceInput, parseEmailInputList } from "./invitees";
import {
  DEFAULT_TIME_ZONE,
  type InviteeRole,
  type MeetingAccessType,
  isMeetingAccessType,
  isValidTimeZone,
  localDateTimeToUtcIso,
} from "./meeting";

export type CreateMeetingFieldErrors = Partial<
  Record<
    | "title"
    | "description"
    | "date"
    | "startTime"
    | "endTime"
    | "timeZone"
    | "hostChapterId"
    | "accessType"
    | "additionalChapters"
    | "cohostEmails"
    | "participantEmails",
    string
  >
>;

export type ParsedInviteInputs = {
  hostChapterId: number;
  sources: InviteSourceInput[];
};

export type ParsedMeetingCreateForm = ParsedInviteInputs & {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  accessType: MeetingAccessType;
};

type AdditionalChapterRow = {
  chapterId: number;
  scope: "chapter_organizers" | "chapter_all";
  role: InviteeRole;
};

function parseAdditionalChapters(raw: string | null): {
  rows: AdditionalChapterRow[];
  error?: string;
} {
  if (!raw || raw.trim().length === 0) return { rows: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { rows: [], error: "他チャプターの指定形式が不正です。" };
  }
  if (!Array.isArray(parsed)) {
    return { rows: [], error: "他チャプターの指定形式が不正です。" };
  }

  const rows: AdditionalChapterRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return { rows: [], error: "他チャプターの指定形式が不正です。" };
    }
    const obj = item as Record<string, unknown>;
    const rawChapterId = String(obj.chapterId ?? "").trim();
    if (!rawChapterId) continue;

    const chapterId = Number(rawChapterId);
    if (!Number.isSafeInteger(chapterId) || chapterId <= 0) {
      return { rows: [], error: "他チャプターの選択が不正です。" };
    }
    const scope =
      obj.scope === "chapter_all"
        ? "chapter_all"
        : obj.scope === "chapter_organizers"
          ? "chapter_organizers"
          : null;
    if (!scope) {
      return { rows: [], error: "他チャプターの対象範囲が不正です。" };
    }
    const role =
      obj.role === "cohost" ? "cohost" : obj.role === "participant" ? "participant" : null;
    if (!role) {
      return { rows: [], error: "他チャプターの役割が不正です。" };
    }
    rows.push({ chapterId, scope, role });
  }
  return { rows };
}

/** 招待元に関するフォーム入力のみを検証・抽出する（プレビュー・作成で共用）。 */
export function parseMeetingInviteInputs(
  formData: FormData,
  allowedChapterIds: ReadonlySet<number>,
): { ok: true; data: ParsedInviteInputs } | { ok: false; fieldErrors: CreateMeetingFieldErrors } {
  const fieldErrors: CreateMeetingFieldErrors = {};

  const hostChapterId = Number(String(formData.get("hostChapterId") ?? "").trim());
  if (!Number.isSafeInteger(hostChapterId) || !allowedChapterIds.has(hostChapterId)) {
    fieldErrors.hostChapterId = "所属チャプターから主催チャプターを選択してください。";
  }

  const includeHostOrganizersRaw = String(formData.get("includeHostOrganizers") ?? "").trim();
  const includeHostOrganizers =
    includeHostOrganizersRaw === "true" || includeHostOrganizersRaw === "on";

  const additionalResult = parseAdditionalChapters(
    formData.get("additionalChapters") === null ? null : String(formData.get("additionalChapters")),
  );
  if (additionalResult.error) {
    fieldErrors.additionalChapters = additionalResult.error;
  }

  const cohostParsed = parseEmailInputList(String(formData.get("cohostEmails") ?? ""));
  if (cohostParsed.googleGroupEmails.length > 0) {
    fieldErrors.cohostEmails = `Google グループ（googlegroups.com）は招待先に指定できません: ${cohostParsed.googleGroupEmails.join(", ")}`;
  } else if (cohostParsed.invalidEmails.length > 0) {
    fieldErrors.cohostEmails = `メールアドレスの形式が正しくありません: ${cohostParsed.invalidEmails.join(", ")}`;
  }

  const participantParsed = parseEmailInputList(String(formData.get("participantEmails") ?? ""));
  if (participantParsed.googleGroupEmails.length > 0) {
    fieldErrors.participantEmails = `Google グループ（googlegroups.com）は招待先に指定できません: ${participantParsed.googleGroupEmails.join(", ")}`;
  } else if (participantParsed.invalidEmails.length > 0) {
    fieldErrors.participantEmails = `メールアドレスの形式が正しくありません: ${participantParsed.invalidEmails.join(", ")}`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const sources: InviteSourceInput[] = [];
  if (includeHostOrganizers) {
    sources.push({
      kind: "host_chapter_organizers",
      chapterId: hostChapterId,
      email: null,
      role: "cohost",
    });
  }
  for (const row of additionalResult.rows) {
    sources.push({
      kind: row.scope,
      chapterId: row.chapterId,
      email: null,
      role: row.role,
    });
  }
  for (const email of cohostParsed.emails) {
    sources.push({ kind: "email", chapterId: null, email, role: "cohost" });
  }
  for (const email of participantParsed.emails) {
    sources.push({ kind: "email", chapterId: null, email, role: "participant" });
  }

  return { ok: true, data: { hostChapterId, sources } };
}

/** 会議作成フォーム全体を検証してドメイン入力へ変換する。 */
export function parseMeetingCreateForm(
  formData: FormData,
  allowedChapterIds: ReadonlySet<number>,
):
  | { ok: true; data: ParsedMeetingCreateForm }
  | { ok: false; fieldErrors: CreateMeetingFieldErrors } {
  const fieldErrors: CreateMeetingFieldErrors = {};

  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) {
    fieldErrors.title = "会議タイトルを入力してください。";
  } else if (title.length > 200) {
    fieldErrors.title = "会議タイトルは 200 文字以内で入力してください。";
  }

  const description = String(formData.get("description") ?? "").trim();
  if (description.length > 4000) {
    fieldErrors.description = "説明は 4000 文字以内で入力してください。";
  }

  const timeZone =
    String(formData.get("timeZone") ?? DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    fieldErrors.timeZone = "有効なタイムゾーンを選択してください。";
  }

  const date = String(formData.get("date") ?? "").trim();
  const startTime = String(formData.get("startTime") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim();
  if (!date) fieldErrors.date = "日付を入力してください。";
  if (!startTime) fieldErrors.startTime = "開始時刻を入力してください。";
  if (!endTime) fieldErrors.endTime = "終了時刻を入力してください。";

  let startAt: string | null = null;
  let endAt: string | null = null;
  if (
    !fieldErrors.timeZone &&
    !fieldErrors.date &&
    !fieldErrors.startTime &&
    !fieldErrors.endTime
  ) {
    startAt = localDateTimeToUtcIso(date, startTime, timeZone);
    endAt = localDateTimeToUtcIso(date, endTime, timeZone);
    if (!startAt) fieldErrors.startTime = "有効な日付・開始時刻を入力してください。";
    if (!endAt) fieldErrors.endTime = "有効な日付・終了時刻を入力してください。";
    if (startAt && endAt && endAt <= startAt) {
      fieldErrors.endTime = "終了時刻は開始時刻より後に設定してください。";
    }
  }

  const accessTypeRaw = String(formData.get("accessType") ?? "RESTRICTED").trim();
  if (!isMeetingAccessType(accessTypeRaw)) {
    fieldErrors.accessType = "アクセスの種類を選択してください。";
  }

  const inviteResult = parseMeetingInviteInputs(formData, allowedChapterIds);
  if (!inviteResult.ok) {
    Object.assign(fieldErrors, inviteResult.fieldErrors);
  }

  if (
    Object.keys(fieldErrors).length > 0 ||
    !inviteResult.ok ||
    !startAt ||
    !endAt ||
    !isMeetingAccessType(accessTypeRaw)
  ) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      title,
      description,
      startAt,
      endAt,
      timeZone,
      accessType: accessTypeRaw,
      hostChapterId: inviteResult.data.hostChapterId,
      sources: inviteResult.data.sources,
    },
  };
}
