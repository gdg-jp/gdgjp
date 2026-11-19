import type { ChapterRole, MeetActor, MeetDirectoryMember } from "@gdgjp/gdg-lib";
import { DirectoryError, fetchChapterMembers } from "~/features/directory/directory.server";
import type { CalendarAttendee } from "~/features/google/calendar.server";
import { GoogleApiError } from "~/features/google/client.server";
import { normalizeEmail } from "~/features/google/email";
import { GoogleConnectionError } from "~/features/google/token.server";
import type { PreviewInviteesResult } from "./create.server";
import { parseMeetingEditInviteInputs } from "./form";
import {
  type InviteSourceInput,
  MAX_COHOSTS,
  MAX_INVITEES,
  type ResolveInviteesResult,
  type ResolvedInvitee,
  resolveInvitees,
} from "./invitees";
import type { MeetingInviteeRecord, MeetingRecord } from "./meeting";

export function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function buildCalendarDescription(userDescription: string, meetingUrl: string): string {
  const linkLine = `管理ページ: ${meetingUrl}`;
  return userDescription ? `${userDescription}\n\n${linkLine}` : linkLine;
}

export function buildCalendarAttendees(invitees: readonly ResolvedInvitee[]): CalendarAttendee[] {
  return invitees.map((inv) =>
    inv.displayName ? { email: inv.email, displayName: inv.displayName } : { email: inv.email },
  );
}

/** 外部へ表示可能な安全なエラー要約へ整形する（トークン・機密を含めない）。 */
export function toSafeErrorSummary(error: unknown): string {
  if (error instanceof GoogleConnectionError) {
    return error.message.slice(0, 240);
  }
  if (error instanceof GoogleApiError) {
    const statusLabel = error.apiStatus
      ? `${error.httpStatus} ${error.apiStatus}`
      : String(error.httpStatus);
    return `Google API エラー (${statusLabel}): ${error.apiMessage}`.slice(0, 240);
  }
  if (error instanceof Error) {
    return error.message.slice(0, 240);
  }
  return "予期しないエラーが発生しました";
}

/** `DirectoryError` を画面向けの日本語メッセージへ変換する。 */
export function formatDirectoryError(error: DirectoryError): string {
  if (error.code === "forbidden") {
    return "チャプターメンバーの取得には、いずれかのチャプターへの所属が必要です。チャプターに所属している共同主催者に操作を依頼してください。";
  }
  return "チャプターメンバーの取得に失敗しました。時間をおいて再度お試しください。";
}

/** `resolveInvitees` の失敗結果を画面向けの日本語メッセージへ変換する。 */
export function formatResolveInviteesError(
  resolved: Extract<ResolveInviteesResult, { ok: false }>,
): string {
  if (resolved.code === "too_many_invitees") {
    return `招待者が上限（${MAX_INVITEES} 人）を超えています（現在 ${resolved.count} 人）。招待先を減らしてください。`;
  }
  if (resolved.code === "too_many_cohosts") {
    return `共同主催者が上限（${MAX_COHOSTS} 人）を超えています（現在 ${resolved.count} 人）。共同主催者を減らしてください。`;
  }
  if (resolved.code === "google_group_not_allowed") {
    return `Google グループ（googlegroups.com）は招待先に指定できません: ${resolved.emails.join(", ")}`;
  }
  if (resolved.code === "invalid_email") {
    return `メールアドレスの形式が正しくありません: ${resolved.emails.join(", ")}`;
  }
  return "招待者の解決に失敗しました。入力内容を確認してください。";
}

/**
 * 招待元一覧から必要なチャプター ID とロールを集約し、必ず `features/directory` の
 * `fetchChapterMembers` 経由でアクティブメンバーを取得する。
 */
export async function fetchMembersForSources(
  env: Env,
  actor: MeetActor,
  sources: readonly InviteSourceInput[],
): Promise<MeetDirectoryMember[]> {
  const chapterIdSet = new Set<number>();
  let needsAllRoles = false;

  for (const source of sources) {
    if (source.kind === "email" || source.chapterId === null) continue;
    chapterIdSet.add(source.chapterId);
    if (source.kind === "chapter_all") {
      needsAllRoles = true;
    }
  }

  if (chapterIdSet.size === 0) return [];

  const roles: ChapterRole[] = needsAllRoles ? ["organizer", "member"] : ["organizer"];
  return fetchChapterMembers(env, {
    actor,
    chapterIds: [...chapterIdSet],
    roles,
  });
}

function canonicalizeSource(
  source: Pick<InviteSourceInput, "kind" | "chapterId" | "email" | "role">,
): string {
  const emailPart = source.email ? source.email.trim() : "";
  return `${source.kind}|${source.chapterId ?? ""}|${emailPart}|${source.role}`;
}

/** 招待元（`meeting_invite_sources`）の定義に変更があるか判定する。 */
export function haveInviteSourcesChanged(
  existingSources: readonly Pick<InviteSourceInput, "kind" | "chapterId" | "email" | "role">[],
  nextSources: readonly Pick<InviteSourceInput, "kind" | "chapterId" | "email" | "role">[],
): boolean {
  if (existingSources.length !== nextSources.length) return true;
  const left = existingSources.map(canonicalizeSource).sort();
  const right = nextSources.map(canonicalizeSource).sort();
  return left.some((key, index) => key !== right[index]);
}

function canonicalizeInvitee(
  invitee: Pick<ResolvedInvitee, "emailNormalized" | "email" | "displayName" | "role">,
): string {
  return `${invitee.emailNormalized}|${invitee.email}|${invitee.displayName ?? ""}|${invitee.role}`;
}

/** 解決済み招待者一覧に実質的な差分（追加・削除・役割変更・表示名変更）があるか判定する。 */
export function haveInviteesChanged(
  existingInvitees: readonly Pick<
    MeetingInviteeRecord,
    "emailNormalized" | "email" | "displayName" | "role"
  >[],
  nextInvitees: readonly Pick<
    ResolvedInvitee,
    "emailNormalized" | "email" | "displayName" | "role"
  >[],
): boolean {
  if (existingInvitees.length !== nextInvitees.length) return true;
  const left = existingInvitees.map(canonicalizeInvitee).sort();
  const right = nextInvitees.map(canonicalizeInvitee).sort();
  return left.some((key, index) => key !== right[index]);
}

/** 既存の招待者スナップショットまたはチャプターメンバーから作成者の表示名を復元する。 */
export function resolveCreatorDisplayName(
  meeting: Pick<MeetingRecord, "createdByEmail">,
  existingInvitees: readonly MeetingInviteeRecord[],
  chapterMembers: readonly MeetDirectoryMember[],
): string {
  const creatorNorm = normalizeEmail(meeting.createdByEmail);
  const existingCreator = existingInvitees.find((inv) => inv.emailNormalized === creatorNorm);
  if (existingCreator?.displayName) return existingCreator.displayName;
  const memberCreator = chapterMembers.find((m) => normalizeEmail(m.email) === creatorNorm);
  if (memberCreator?.name) return memberCreator.name;
  return meeting.createdByEmail;
}

/** 編集画面用の招待者数プレビューを解決し、**人数のみ**を返す。 */
export async function previewEditMeetingInvitees(
  env: Env,
  actor: MeetActor,
  meeting: MeetingRecord,
  existingInvitees: readonly MeetingInviteeRecord[],
  formData: FormData,
): Promise<PreviewInviteesResult> {
  const parsed = parseMeetingEditInviteInputs(formData, meeting.hostChapterId);
  if (!parsed.ok) {
    const firstError =
      Object.values(parsed.fieldErrors).find(Boolean) ?? "入力内容を確認してください。";
    return { ok: false, error: firstError };
  }

  let chapterMembers: MeetDirectoryMember[];
  try {
    chapterMembers = await fetchMembersForSources(env, actor, parsed.data.sources);
  } catch (error) {
    if (error instanceof DirectoryError) {
      return { ok: false, error: formatDirectoryError(error) };
    }
    throw error;
  }

  const resolved = resolveInvitees({
    creator: {
      userId: meeting.createdByUserId,
      email: meeting.createdByEmail,
      name: resolveCreatorDisplayName(meeting, existingInvitees, chapterMembers),
    },
    hostChapterId: meeting.hostChapterId,
    sources: parsed.data.sources,
    chapterMembers,
    hostEmail: env.GOOGLE_HOST_EMAIL,
  });

  if (!resolved.ok) {
    if (resolved.code === "too_many_invitees") {
      return {
        ok: false,
        error: `招待者が上限（${MAX_INVITEES} 人）を超えています（現在 ${resolved.count} 人）。`,
        counts: resolved.counts,
      };
    }
    if (resolved.code === "too_many_cohosts") {
      return {
        ok: false,
        error: `共同主催者が上限（${MAX_COHOSTS} 人）を超えています（現在 ${resolved.count} 人）。`,
        counts: resolved.counts,
      };
    }
    return {
      ok: false,
      error: "Google グループ（googlegroups.com）または不正なメールアドレスが含まれています。",
    };
  }

  return { ok: true, counts: resolved.counts };
}
