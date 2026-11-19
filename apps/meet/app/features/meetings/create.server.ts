import type { ChapterRole, MeetActor } from "@gdgjp/gdg-lib";
import { DirectoryError, fetchChapterMembers } from "~/features/directory/directory.server";
import { insertEvent } from "~/features/google/calendar.server";
import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { type MeetSpace, createSpace } from "~/features/google/meet.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import { GoogleConnectionError, getGoogleAccessToken } from "~/features/google/token.server";
import {
  type CreateMeetingFieldErrors,
  parseMeetingCreateForm,
  parseMeetingInviteInputs,
} from "./form";
import { type InviteSourceInput, MAX_COHOSTS, MAX_INVITEES, resolveInvitees } from "./invitees";
import type { InviteePreviewCounts } from "./meeting";
import {
  insertCreatingMeeting,
  markMeetingActive,
  markMeetingFailed,
  updateMeetingLastError,
  updateMeetingSpace,
} from "./meetings.repository.server";

export type { CreateMeetingFieldErrors };

export type CreateMeetingResult =
  | { ok: true; meetingId: string }
  | {
      ok: false;
      meetingId?: string;
      formError?: string;
      fieldErrors?: CreateMeetingFieldErrors;
    };

export type PreviewInviteesResult =
  | { ok: true; counts: InviteePreviewCounts }
  | { ok: false; error: string; counts?: InviteePreviewCounts };

export type CreateMeetingDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
  generateId?: () => string;
};

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toSafeErrorSummary(error: unknown): string {
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

async function fetchMembersForSources(
  env: Env,
  actor: MeetActor,
  sources: readonly InviteSourceInput[],
) {
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

function buildCalendarDescription(userDescription: string, meetingUrl: string): string {
  const linkLine = `管理ページ: ${meetingUrl}`;
  return userDescription ? `${userDescription}\n\n${linkLine}` : linkLine;
}

/**
 * フォーム送信前の招待者数内訳をサーバー側で解決し、**人数のみ**を返す。
 * チャプターメンバーのメールアドレスや氏名はブラウザへ一切返さない。
 */
export async function previewMeetingInvitees(
  env: Env,
  actor: MeetActor,
  formData: FormData,
): Promise<PreviewInviteesResult> {
  const allowedChapterIds = new Set(actor.chapters.map((c) => c.chapterId));
  const parsed = parseMeetingInviteInputs(formData, allowedChapterIds);
  if (!parsed.ok) {
    const firstError =
      Object.values(parsed.fieldErrors).find(Boolean) ?? "入力内容を確認してください。";
    return { ok: false, error: firstError };
  }

  let chapterMembers: Awaited<ReturnType<typeof fetchMembersForSources>>;
  try {
    chapterMembers = await fetchMembersForSources(env, actor, parsed.data.sources);
  } catch (error) {
    if (error instanceof DirectoryError) {
      return {
        ok: false,
        error: "チャプターメンバーの取得に失敗しました。時間をおいて再度お試しください。",
      };
    }
    throw error;
  }

  const resolved = resolveInvitees({
    creator: { userId: actor.user.id, email: actor.user.email, name: actor.user.name },
    hostChapterId: parsed.data.hostChapterId,
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

/**
 * 方式 B（Meet スペース先行作成 → Calendar 予定結び付け → `MEET_JOBS` で非同期メンバー同期）で会議を作成する。
 */
export async function createMeeting(
  env: Env,
  actor: MeetActor,
  formData: FormData,
  deps: CreateMeetingDeps = {},
): Promise<CreateMeetingResult> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const generateId = deps.generateId ?? (() => crypto.randomUUID());

  const connection = await getGoogleConnectionSummary(env.DB);
  if (connection.status !== "connected") {
    return {
      ok: false,
      formError:
        "共有 Google アカウントが接続されていないため会議を作成できません。管理者が接続するまでお待ちください。",
    };
  }

  const allowedChapterIds = new Set(actor.chapters.map((c) => c.chapterId));
  const parsed = parseMeetingCreateForm(formData, allowedChapterIds);
  if (!parsed.ok) {
    return { ok: false, fieldErrors: parsed.fieldErrors };
  }

  let chapterMembers: Awaited<ReturnType<typeof fetchMembersForSources>>;
  try {
    chapterMembers = await fetchMembersForSources(env, actor, parsed.data.sources);
  } catch (error) {
    if (error instanceof DirectoryError) {
      return {
        ok: false,
        formError: "チャプターメンバーの取得に失敗しました。時間をおいて再度お試しください。",
      };
    }
    throw error;
  }

  const resolved = resolveInvitees({
    creator: { userId: actor.user.id, email: actor.user.email, name: actor.user.name },
    hostChapterId: parsed.data.hostChapterId,
    sources: parsed.data.sources,
    chapterMembers,
    hostEmail: env.GOOGLE_HOST_EMAIL,
  });

  if (!resolved.ok) {
    if (resolved.code === "too_many_invitees") {
      return {
        ok: false,
        formError: `招待者が上限（${MAX_INVITEES} 人）を超えています（現在 ${resolved.count} 人）。招待先を減らしてください。`,
      };
    }
    if (resolved.code === "too_many_cohosts") {
      return {
        ok: false,
        formError: `共同主催者が上限（${MAX_COHOSTS} 人）を超えています（現在 ${resolved.count} 人）。共同主催者を減らしてください。`,
      };
    }
    if (resolved.code === "google_group_not_allowed") {
      return {
        ok: false,
        formError: `Google グループ（googlegroups.com）は招待先に指定できません: ${resolved.emails.join(", ")}`,
      };
    }
    if (resolved.code === "invalid_email") {
      return {
        ok: false,
        formError: `メールアドレスの形式が正しくありません: ${resolved.emails.join(", ")}`,
      };
    }
    return {
      ok: false,
      formError: "招待者の解決に失敗しました。入力内容を確認してください。",
    };
  }

  const meetingId = generateId();
  const createdAtIso = now().toISOString();

  await insertCreatingMeeting(env.DB, {
    id: meetingId,
    hostChapterId: parsed.data.hostChapterId,
    title: parsed.data.title,
    description: parsed.data.description,
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt,
    timeZone: parsed.data.timeZone,
    accessType: parsed.data.accessType,
    createdByUserId: actor.user.id,
    createdByEmail: actor.user.email,
    nowIso: createdAtIso,
    sources: parsed.data.sources.map((source) => ({
      id: generateId(),
      ...source,
    })),
    invitees: resolved.invitees,
  });

  let createdSpace: MeetSpace | null = null;
  try {
    const accessToken = await getGoogleAccessToken(env, fetchFn);
    createdSpace = await createSpace(
      accessToken,
      { accessType: parsed.data.accessType, moderation: "ON" },
      fetchFn,
    );

    // 後続の Calendar API が失敗してもスペース情報を失わないよう先に保存する。
    await updateMeetingSpace(env.DB, meetingId, {
      spaceName: createdSpace.name,
      meetingUri: createdSpace.meetingUri,
      meetingCode: createdSpace.meetingCode,
      updatedAt: now().toISOString(),
    });

    const meetingUrl = `${trimTrailingSlash(env.APP_URL)}/meetings/${meetingId}`;
    const calendarEvent = await insertEvent(
      accessToken,
      {
        calendarId: "primary",
        conferenceDataVersion: 1,
        sendUpdates: "all",
        body: {
          summary: parsed.data.title,
          description: buildCalendarDescription(parsed.data.description, meetingUrl),
          start: { dateTime: parsed.data.startAt, timeZone: parsed.data.timeZone },
          end: { dateTime: parsed.data.endAt, timeZone: parsed.data.timeZone },
          attendees: resolved.invitees.map((inv) =>
            inv.displayName
              ? { email: inv.email, displayName: inv.displayName }
              : { email: inv.email },
          ),
          guestsCanSeeOtherGuests: false,
          guestsCanInviteOthers: false,
          guestsCanModify: false,
          conferenceData: {
            conferenceSolution: { key: { type: "hangoutsMeet" } },
            entryPoints: [
              {
                entryPointType: "video",
                uri: createdSpace.meetingUri,
                label: createdSpace.meetingUri.replace(/^https?:\/\//, ""),
              },
            ],
          },
          extendedProperties: {
            private: { gdgsMeetId: meetingId },
          },
        },
      },
      fetchFn,
    );

    await markMeetingActive(env.DB, meetingId, {
      spaceName: createdSpace.name,
      meetingUri: createdSpace.meetingUri,
      meetingCode: createdSpace.meetingCode,
      calendarEventId: calendarEvent.id,
      calendarHtmlLink: calendarEvent.htmlLink ?? null,
      updatedAt: now().toISOString(),
    });
  } catch (error) {
    const safeError = toSafeErrorSummary(error);
    await markMeetingFailed(env.DB, meetingId, {
      lastError: safeError,
      spaceName: createdSpace?.name ?? null,
      meetingUri: createdSpace?.meetingUri ?? null,
      meetingCode: createdSpace?.meetingCode ?? null,
      updatedAt: now().toISOString(),
    });
    return { ok: false, meetingId, formError: safeError };
  }

  try {
    await env.MEET_JOBS.send({ type: "sync_members", meetingId });
  } catch (error) {
    // 会議と予定自体は作成済みのため active を維持し、同期キュー投入エラーのみ警告として残す。
    await updateMeetingLastError(
      env.DB,
      meetingId,
      `メンバー同期ジョブの投入に失敗しました: ${toSafeErrorSummary(error)}`.slice(0, 240),
      now().toISOString(),
    );
  }

  return { ok: true, meetingId };
}
