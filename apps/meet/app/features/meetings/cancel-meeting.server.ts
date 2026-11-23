import { deleteEvent } from "~/features/google/calendar.server";
import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { getGoogleConnectionSummary } from "~/features/google/oauth.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import { toSafeErrorSummary } from "./invite-resolution.server";
import type { MeetingRecord } from "./meeting";
import { markMeetingCanceled, updateMeetingLastError } from "./meetings.repository.server";

export type CancelMeetingResult =
  | { ok: true; meetingId: string }
  | { ok: false; status?: number; error: string };

export type CancelMeetingDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
};

export async function cancelMeeting(
  env: Env,
  meeting: MeetingRecord,
  deps: CancelMeetingDeps = {},
): Promise<CancelMeetingResult> {
  if (meeting.status !== "active") {
    return {
      ok: false,
      status: 409,
      error: "取り消し済みまたは作成失敗の会議は取り消せません。",
    };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  const connection = await getGoogleConnectionSummary(env.DB);
  if (connection.status !== "connected") {
    return {
      ok: false,
      error:
        "共有 Google アカウントが接続されていないため会議を取り消せません。管理者が接続するまでお待ちください。",
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(env, fetchFn);
    if (meeting.calendarEventId) {
      try {
        await deleteEvent(
          accessToken,
          {
            calendarId: "primary",
            eventId: meeting.calendarEventId,
            sendUpdates: "all",
          },
          fetchFn,
        );
      } catch (error) {
        if (
          !(
            error instanceof GoogleApiError &&
            (error.httpStatus === 404 || error.httpStatus === 410)
          )
        ) {
          throw error;
        }
      }
    }
  } catch (error) {
    return { ok: false, error: toSafeErrorSummary(error) };
  }

  const nowIso = now().toISOString();
  await markMeetingCanceled(env.DB, meeting.id, { canceledAt: nowIso, updatedAt: nowIso });

  try {
    await env.MEET_JOBS.send({ type: "cleanup_meeting", meetingId: meeting.id });
  } catch (error) {
    await updateMeetingLastError(
      env.DB,
      meeting.id,
      `クリーンアップジョブの投入に失敗しました: ${toSafeErrorSummary(error)}`.slice(0, 240),
      now().toISOString(),
    );
  }

  return { ok: true, meetingId: meeting.id };
}
