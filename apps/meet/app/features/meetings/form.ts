import { type InviteSourceInput, parseEmailInputList } from "./invitees";
import {
  DEFAULT_TIME_ZONE,
  type InviteeRole,
  type MeetingAccessType,
  type MeetingAutoArtifacts,
  type MeetingInviteSourceRecord,
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

export type ParsedMeetingCreateForm = ParsedInviteInputs &
  MeetingAutoArtifacts & {
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    timeZone: string;
    accessType: MeetingAccessType;
  };

export type AdditionalChapterRow = {
  chapterId: number;
  scope: "chapter_organizers" | "chapter_all";
  role: InviteeRole;
};

export type MeetingFormInviteDefaults = {
  includeHostOrganizers: boolean;
  additionalChapters: AdditionalChapterRow[];
  cohostEmails: string;
  participantEmails: string;
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

function parseCheckboxFlag(value: FormDataEntryValue | null): boolean {
  const raw = String(value ?? "").trim();
  return raw === "true" || raw === "on";
}

function parseInviteSourcesWithHostChapter(
  formData: FormData,
  hostChapterId: number,
  initialErrors: CreateMeetingFieldErrors,
): { ok: true; data: ParsedInviteInputs } | { ok: false; fieldErrors: CreateMeetingFieldErrors } {
  const fieldErrors: CreateMeetingFieldErrors = { ...initialErrors };

  const includeHostOrganizers = parseCheckboxFlag(formData.get("includeHostOrganizers"));

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

/** 招待元に関するフォーム入力のみを検証・抽出する（作成前のプレビュー・作成で共用）。 */
export function parseMeetingInviteInputs(
  formData: FormData,
  allowedChapterIds: ReadonlySet<number>,
): { ok: true; data: ParsedInviteInputs } | { ok: false; fieldErrors: CreateMeetingFieldErrors } {
  const initialErrors: CreateMeetingFieldErrors = {};
  const hostChapterId = Number(String(formData.get("hostChapterId") ?? "").trim());
  if (!Number.isSafeInteger(hostChapterId) || !allowedChapterIds.has(hostChapterId)) {
    initialErrors.hostChapterId = "所属チャプターから主催チャプターを選択してください。";
  }
  return parseInviteSourcesWithHostChapter(formData, hostChapterId, initialErrors);
}

/** 編集画面用の招待元フォーム入力を検証・抽出する（主催チャプターは既存の値で固定）。 */
export function parseMeetingEditInviteInputs(
  formData: FormData,
  fixedHostChapterId: number,
): { ok: true; data: ParsedInviteInputs } | { ok: false; fieldErrors: CreateMeetingFieldErrors } {
  return parseInviteSourcesWithHostChapter(formData, fixedHostChapterId, {});
}

function parseMeetingCommonFields(
  formData: FormData,
  inviteResult:
    | { ok: true; data: ParsedInviteInputs }
    | { ok: false; fieldErrors: CreateMeetingFieldErrors },
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

  const autoTranscription = parseCheckboxFlag(formData.get("autoTranscription"));
  const autoSmartNotes = parseCheckboxFlag(formData.get("autoSmartNotes"));
  const autoRecording = parseCheckboxFlag(formData.get("autoRecording"));

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
      autoTranscription,
      autoSmartNotes,
      autoRecording,
      hostChapterId: inviteResult.data.hostChapterId,
      sources: inviteResult.data.sources,
    },
  };
}

/** 会議作成フォーム全体を検証してドメイン入力へ変換する。 */
export function parseMeetingCreateForm(
  formData: FormData,
  allowedChapterIds: ReadonlySet<number>,
):
  | { ok: true; data: ParsedMeetingCreateForm }
  | { ok: false; fieldErrors: CreateMeetingFieldErrors } {
  const inviteResult = parseMeetingInviteInputs(formData, allowedChapterIds);
  return parseMeetingCommonFields(formData, inviteResult);
}

/** 会議編集フォーム全体を検証してドメイン入力へ変換する（主催チャプターは変更不可）。 */
export function parseMeetingEditForm(
  formData: FormData,
  fixedHostChapterId: number,
):
  | { ok: true; data: ParsedMeetingCreateForm }
  | { ok: false; fieldErrors: CreateMeetingFieldErrors } {
  const inviteResult = parseMeetingEditInviteInputs(formData, fixedHostChapterId);
  return parseMeetingCommonFields(formData, inviteResult);
}

/** D1 の `meeting_invite_sources` から `MeetingForm` の初期値へ変換する。 */
export function inviteSourcesToFormDefaults(
  sources: readonly Pick<MeetingInviteSourceRecord, "kind" | "chapterId" | "email" | "role">[],
): MeetingFormInviteDefaults {
  let includeHostOrganizers = false;
  const additionalChapters: AdditionalChapterRow[] = [];
  const cohostEmailList: string[] = [];
  const participantEmailList: string[] = [];

  for (const source of sources) {
    if (source.kind === "host_chapter_organizers") {
      includeHostOrganizers = true;
      continue;
    }
    if (
      (source.kind === "chapter_organizers" || source.kind === "chapter_all") &&
      source.chapterId !== null
    ) {
      additionalChapters.push({
        chapterId: source.chapterId,
        scope: source.kind,
        role: source.role,
      });
      continue;
    }
    if (source.kind === "email" && source.email) {
      if (source.role === "cohost") {
        cohostEmailList.push(source.email);
      } else {
        participantEmailList.push(source.email);
      }
    }
  }

  return {
    includeHostOrganizers,
    additionalChapters,
    cohostEmails: cohostEmailList.join("\n"),
    participantEmails: participantEmailList.join("\n"),
  };
}
