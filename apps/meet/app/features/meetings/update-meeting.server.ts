import type { MeetActor, MeetDirectoryMember } from "@gdgjp/gdg-lib";
import { DirectoryError } from "~/features/directory/directory.server";
import {
  type CalendarEventBody,
  attendeeUpdates,
  patchEvent,
} from "~/features/google/calendar.server";
import type { GoogleFetch } from "~/features/google/client.server";
import { patchSpace } from "~/features/google/meet.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import {
  findUnshareableInvitees,
  formatUnshareableInviteesError,
} from "~/features/invitee-checks/check-invitees.server";
import {
  enqueueArtifactReshareForMeeting,
  enqueueArtifactReshareSafely,
} from "./artifact-reshare.server";
import { type CreateMeetingFieldErrors, parseMeetingEditForm } from "./form";
import {
  buildCalendarAttendees,
  buildCalendarDescription,
  fetchMembersForSources,
  formatDirectoryError,
  formatResolveInviteesError,
  haveInviteSourcesChanged,
  haveInviteesChanged,
  previewEditMeetingInvitees,
  resolveCreatorDisplayName,
  summarizeInviteeDiff,
  toSafeErrorSummary,
  trimTrailingSlash,
} from "./invite-resolution.server";
import { type InviteSourceInput, type ResolvedInvitee, resolveInvitees } from "./invitees";
import type { MeetingInviteSourceRecord, MeetingInviteeRecord, MeetingRecord } from "./meeting";
import {
  replaceMeetingInviteSourcesAndInvitees,
  replaceMeetingInvitees,
  updateMeetingDetails,
  updateMeetingLastError,
} from "./meetings.repository.server";
import { buildSpaceConfigPatch } from "./space-config.server";

export {
  haveInviteSourcesChanged,
  haveInviteesChanged,
  previewEditMeetingInvitees,
  summarizeInviteeDiff,
};

export type UpdateMeetingResult =
  | {
      ok: true;
      meetingId: string;
      inviteesChanged: boolean;
      cohostAdded: boolean;
      inviteeRemoved: boolean;
    }
  | {
      ok: false;
      status?: number;
      formError?: string;
      fieldErrors?: CreateMeetingFieldErrors;
    };

export type ResyncMeetingResult =
  | {
      ok: true;
      changed: boolean;
      totalCount: number;
      cohostAdded: boolean;
      inviteeRemoved: boolean;
    }
  | { ok: false; status?: number; error: string };

export type UpdateMeetingDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
  generateId?: () => string;
  enqueueArtifactReshareFn?: (env: Env, meetingId: string) => Promise<void>;
};

export async function updateMeeting(
  env: Env,
  actor: MeetActor,
  meeting: MeetingRecord,
  existingSources: readonly MeetingInviteSourceRecord[],
  existingInvitees: readonly MeetingInviteeRecord[],
  formData: FormData,
  deps: UpdateMeetingDeps = {},
): Promise<UpdateMeetingResult> {
  if (meeting.status !== "active") {
    return {
      ok: false,
      status: 409,
      formError: "取り消し済みまたは作成失敗の会議は編集できません。",
    };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const enqueueArtifactReshareFn =
    deps.enqueueArtifactReshareFn ?? enqueueArtifactReshareForMeeting;

  const connection = await getGoogleConnectionSummary(env.DB);
  if (connection.status !== "connected") {
    return {
      ok: false,
      formError:
        "共有 Google アカウントが接続されていないため会議を更新できません。管理者が接続するまでお待ちください。",
    };
  }

  const parsed = parseMeetingEditForm(formData, meeting.hostChapterId);
  if (!parsed.ok) {
    return { ok: false, fieldErrors: parsed.fieldErrors };
  }

  if (!meeting.spaceName || !meeting.calendarEventId) {
    return {
      ok: false,
      formError:
        "会議の Google スペースまたはカレンダー予定の情報が不足しているため更新できません。",
    };
  }

  const sourcesChanged = haveInviteSourcesChanged(existingSources, parsed.data.sources);
  let nextInvitees: ResolvedInvitee[] | null = null;
  let inviteesChanged = false;

  if (sourcesChanged) {
    let chapterMembers: MeetDirectoryMember[];
    try {
      chapterMembers = await fetchMembersForSources(env, actor, parsed.data.sources);
    } catch (error) {
      if (error instanceof DirectoryError) {
        return { ok: false, formError: formatDirectoryError(error) };
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
      return { ok: false, formError: formatResolveInviteesError(resolved) };
    }

    nextInvitees = resolved.invitees;
    inviteesChanged = haveInviteesChanged(existingInvitees, resolved.invitees);
    if (inviteesChanged) {
      const unshareable = await findUnshareableInvitees(
        env,
        {
          actorLocalUserId: actor.user.id,
          invitees: resolved.invitees,
          existingInvitees,
        },
        { fetchFn, now },
      );
      if (unshareable.length > 0) {
        return { ok: false, formError: formatUnshareableInviteesError(unshareable) };
      }
    }
  }

  let patchedHtmlLink: string | null = null;
  try {
    const accessToken = await getGoogleAccessToken(env, fetchFn);

    const spacePatch = buildSpaceConfigPatch(meeting, parsed.data);
    if (spacePatch) {
      await patchSpace(
        accessToken,
        meeting.spaceName,
        spacePatch.config,
        spacePatch.updateMask,
        fetchFn,
      );
    }

    const meetingUrl = `${trimTrailingSlash(env.APP_URL)}/meetings/${meeting.id}`;
    const patchBody: CalendarEventBody = {
      summary: parsed.data.title,
      description: buildCalendarDescription(parsed.data.description, meetingUrl),
      start: { dateTime: parsed.data.startAt, timeZone: parsed.data.timeZone },
      end: { dateTime: parsed.data.endAt, timeZone: parsed.data.timeZone },
      guestsCanSeeOtherGuests: true,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
    };
    if (inviteesChanged && nextInvitees) {
      patchBody.attendees = buildCalendarAttendees(nextInvitees);
    }

    const patchedEvent = await patchEvent(
      accessToken,
      {
        calendarId: "primary",
        eventId: meeting.calendarEventId,
        sendUpdates: attendeeUpdates(env),
        body: patchBody,
      },
      fetchFn,
    );
    patchedHtmlLink = patchedEvent.htmlLink ?? null;
  } catch (error) {
    return { ok: false, formError: toSafeErrorSummary(error) };
  }

  const updatedAt = now().toISOString();
  if (sourcesChanged && nextInvitees) {
    await replaceMeetingInviteSourcesAndInvitees(env.DB, meeting.id, {
      sources: parsed.data.sources.map((source) => ({ id: generateId(), ...source })),
      invitees: nextInvitees,
      nowIso: updatedAt,
    });
  }

  await updateMeetingDetails(env.DB, meeting.id, {
    title: parsed.data.title,
    description: parsed.data.description,
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt,
    timeZone: parsed.data.timeZone,
    accessType: parsed.data.accessType,
    autoTranscription: parsed.data.autoTranscription,
    autoSmartNotes: parsed.data.autoSmartNotes,
    autoRecording: parsed.data.autoRecording,
    calendarHtmlLink: patchedHtmlLink,
    updatedAt,
  });

  if (inviteesChanged) {
    try {
      await env.MEET_JOBS.send({ type: "sync_members", meetingId: meeting.id });
    } catch (error) {
      await updateMeetingLastError(
        env.DB,
        meeting.id,
        `メンバー同期ジョブの投入に失敗しました: ${toSafeErrorSummary(error)}`.slice(0, 240),
        now().toISOString(),
      );
    }
    await enqueueArtifactReshareSafely(env, meeting.id, enqueueArtifactReshareFn, now);
  }

  const diff =
    inviteesChanged && nextInvitees
      ? summarizeInviteeDiff(existingInvitees, nextInvitees)
      : { cohostAdded: false, inviteeRemoved: false };

  return { ok: true, meetingId: meeting.id, inviteesChanged, ...diff };
}

export async function resyncMeetingInvitees(
  env: Env,
  actor: MeetActor,
  meeting: MeetingRecord,
  existingSources: readonly MeetingInviteSourceRecord[],
  existingInvitees: readonly MeetingInviteeRecord[],
  deps: UpdateMeetingDeps = {},
): Promise<ResyncMeetingResult> {
  if (meeting.status !== "active") {
    return {
      ok: false,
      status: 409,
      error: "取り消し済みまたは作成失敗の会議は再同期できません。",
    };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const enqueueArtifactReshareFn =
    deps.enqueueArtifactReshareFn ?? enqueueArtifactReshareForMeeting;

  const connection = await getGoogleConnectionSummary(env.DB);
  if (connection.status !== "connected") {
    return {
      ok: false,
      error:
        "共有 Google アカウントが接続されていないため再同期できません。管理者が接続するまでお待ちください。",
    };
  }

  if (!meeting.calendarEventId) {
    return { ok: false, error: "カレンダー予定 ID が未登録のため再同期できません。" };
  }

  const sourceInputs: InviteSourceInput[] = existingSources.map((s) => ({
    kind: s.kind,
    chapterId: s.chapterId,
    email: s.email,
    role: s.role,
  }));

  let chapterMembers: MeetDirectoryMember[];
  try {
    chapterMembers = await fetchMembersForSources(env, actor, sourceInputs);
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
    sources: sourceInputs,
    chapterMembers,
    hostEmail: env.GOOGLE_HOST_EMAIL,
  });

  if (!resolved.ok) {
    return { ok: false, error: formatResolveInviteesError(resolved) };
  }

  const changed = haveInviteesChanged(existingInvitees, resolved.invitees);
  if (!changed) {
    return {
      ok: true,
      changed: false,
      totalCount: resolved.invitees.length,
      cohostAdded: false,
      inviteeRemoved: false,
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(env, fetchFn);
    await patchEvent(
      accessToken,
      {
        calendarId: "primary",
        eventId: meeting.calendarEventId,
        sendUpdates: attendeeUpdates(env),
        body: {
          attendees: buildCalendarAttendees(resolved.invitees),
          guestsCanSeeOtherGuests: true,
          guestsCanInviteOthers: false,
          guestsCanModify: false,
        },
      },
      fetchFn,
    );
  } catch (error) {
    return { ok: false, error: toSafeErrorSummary(error) };
  }

  await replaceMeetingInvitees(env.DB, meeting.id, {
    invitees: resolved.invitees,
    updatedAt: now().toISOString(),
  });

  try {
    await env.MEET_JOBS.send({ type: "sync_members", meetingId: meeting.id });
  } catch (error) {
    await updateMeetingLastError(
      env.DB,
      meeting.id,
      `メンバー同期ジョブの投入に失敗しました: ${toSafeErrorSummary(error)}`.slice(0, 240),
      now().toISOString(),
    );
  }
  await enqueueArtifactReshareSafely(env, meeting.id, enqueueArtifactReshareFn, now);

  const diff = summarizeInviteeDiff(existingInvitees, resolved.invitees);
  return { ok: true, changed: true, totalCount: resolved.invitees.length, ...diff };
}
