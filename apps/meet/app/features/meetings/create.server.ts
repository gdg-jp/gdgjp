import type { MeetActor } from "@gdgjp/gdg-lib";
import { DirectoryError } from "~/features/directory/directory.server";
import { attendeeUpdates, insertEvent } from "~/features/google/calendar.server";
import type { GoogleFetch } from "~/features/google/client.server";
import { type MeetSpace, createSpace } from "~/features/google/meet.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import {
  findUnshareableInvitees,
  formatUnshareableInviteesError,
} from "~/features/invitee-checks/check-invitees.server";
import {
  type CreateMeetingFieldErrors,
  parseMeetingCreateForm,
  parseMeetingInviteInputs,
} from "./form";
import {
  buildCalendarAttendees,
  buildCalendarDescription,
  fetchMembersForSources,
  formatDirectoryError,
  formatResolveInviteesError,
  toSafeErrorSummary,
  trimTrailingSlash,
} from "./invite-resolution.server";
import { MAX_COHOSTS, MAX_INVITEES, resolveInvitees } from "./invitees";
import type { InviteePreviewCounts } from "./meeting";
import {
  insertCreatingMeeting,
  markMeetingActive,
  markMeetingFailed,
  updateMeetingLastError,
  updateMeetingSpace,
} from "./meetings.repository.server";
import { buildMeetArtifactConfig } from "./space-config.server";

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
      return { ok: false, error: formatDirectoryError(error) };
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
      return { ok: false, formError: formatDirectoryError(error) };
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
    return { ok: false, formError: formatResolveInviteesError(resolved) };
  }

  const unshareable = await findUnshareableInvitees(
    env,
    {
      actorLocalUserId: actor.user.id,
      invitees: resolved.invitees,
    },
    { fetchFn, now },
  );
  if (unshareable.length > 0) {
    return { ok: false, formError: formatUnshareableInviteesError(unshareable) };
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
    autoTranscription: parsed.data.autoTranscription,
    autoSmartNotes: parsed.data.autoSmartNotes,
    autoRecording: parsed.data.autoRecording,
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
      {
        accessType: parsed.data.accessType,
        moderation: "ON",
        artifactConfig: buildMeetArtifactConfig(parsed.data),
      },
      fetchFn,
    );

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
        sendUpdates: attendeeUpdates(env),
        body: {
          summary: parsed.data.title,
          description: buildCalendarDescription(parsed.data.description, meetingUrl),
          start: { dateTime: parsed.data.startAt, timeZone: parsed.data.timeZone },
          end: { dateTime: parsed.data.endAt, timeZone: parsed.data.timeZone },
          attendees: buildCalendarAttendees(resolved.invitees),
          guestsCanSeeOtherGuests: true,
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
    await updateMeetingLastError(
      env.DB,
      meetingId,
      `メンバー同期ジョブの投入に失敗しました: ${toSafeErrorSummary(error)}`.slice(0, 240),
      now().toISOString(),
    );
  }

  return { ok: true, meetingId };
}
