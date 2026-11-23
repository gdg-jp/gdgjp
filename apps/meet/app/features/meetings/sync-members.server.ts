import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { normalizeEmail } from "~/features/google/email";
import {
  type MeetMemberRole,
  createSpaceMember,
  deleteSpaceMember,
  listSpaceMembers,
  memberUserId,
} from "~/features/google/meet.server";
import { GoogleConnectionError, getGoogleAccessToken } from "~/features/google/token.server";
import type { InviteeRole } from "./meeting";
import {
  getMeetingById,
  listMeetingInvitees,
  updateMeetingInviteeGoogleUsers,
  updateMeetingLastError,
} from "./meetings.repository.server";

export type SyncMembersDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
};

function toSafeSyncError(error: unknown): string {
  if (error instanceof GoogleConnectionError) {
    return error.message.slice(0, 240);
  }
  if (error instanceof GoogleApiError) {
    const statusLabel = error.apiStatus
      ? `${error.httpStatus} ${error.apiStatus}`
      : String(error.httpStatus);
    return `メンバー同期エラー (${statusLabel}): ${error.apiMessage}`.slice(0, 240);
  }
  if (error instanceof Error) {
    return `メンバー同期エラー: ${error.message}`.slice(0, 240);
  }
  return "メンバー同期中に予期しないエラーが発生しました";
}

function isRetryableGoogleError(error: GoogleApiError): boolean {
  return error.httpStatus === 429 || error.httpStatus >= 500 || error.httpStatus === 401;
}

export async function syncMeetingMembers(
  env: Env,
  meetingId: string,
  deps: SyncMembersDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  const meeting = await getMeetingById(env.DB, meetingId);
  if (!meeting || meeting.status === "canceled" || !meeting.spaceName) {
    return;
  }

  const invitees = await listMeetingInvitees(env.DB, meetingId);
  const normalizedHostEmail = normalizeEmail(env.GOOGLE_HOST_EMAIL);

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(env, fetchFn);
  } catch (error) {
    await updateMeetingLastError(env.DB, meetingId, toSafeSyncError(error), now().toISOString());
    throw error;
  }

  let existingMembers: Awaited<ReturnType<typeof listSpaceMembers>>;
  try {
    existingMembers = await listSpaceMembers(accessToken, meeting.spaceName, fetchFn);
  } catch (error) {
    await updateMeetingLastError(env.DB, meetingId, toSafeSyncError(error), now().toISOString());
    throw error;
  }

  const existingByEmail = new Map<string, { name: string; role: InviteeRole }>();
  const resolvedGoogleUsers = new Map<string, string | null>();
  for (const member of existingMembers) {
    if (!member.email) continue;
    const norm = normalizeEmail(member.email);
    if (!norm || norm === normalizedHostEmail) continue;
    existingByEmail.set(norm, {
      name: member.name,
      role: member.role === "COHOST" ? "cohost" : "participant",
    });
    resolvedGoogleUsers.set(norm, memberUserId(member.name));
  }

  const desiredByEmail = new Map<string, { email: string; role: InviteeRole }>();
  for (const invitee of invitees) {
    if (invitee.emailNormalized === normalizedHostEmail) continue;
    desiredByEmail.set(invitee.emailNormalized, {
      email: invitee.email,
      role: invitee.role,
    });
  }

  const warnings: string[] = [];

  for (const [emailNorm, desired] of desiredByEmail) {
    const existing = existingByEmail.get(emailNorm);
    const meetRole: MeetMemberRole | undefined = desired.role === "cohost" ? "COHOST" : undefined;

    if (existing && existing.role === desired.role) {
      continue;
    }

    try {
      if (existing) {
        try {
          await deleteSpaceMember(accessToken, existing.name, fetchFn);
        } catch (err) {
          if (!(err instanceof GoogleApiError && err.httpStatus === 404)) {
            throw err;
          }
        }
      }
      const created = await createSpaceMember(
        accessToken,
        meeting.spaceName,
        { email: desired.email, role: meetRole },
        fetchFn,
      );
      resolvedGoogleUsers.set(emailNorm, memberUserId(created.name));
    } catch (error) {
      if (error instanceof GoogleApiError) {
        if (isRetryableGoogleError(error)) {
          await updateMeetingLastError(
            env.DB,
            meetingId,
            toSafeSyncError(error),
            now().toISOString(),
          );
          throw error;
        }
        if (error.httpStatus === 409) continue;
        const statusLabel = error.apiStatus
          ? `${error.httpStatus} ${error.apiStatus}`
          : String(error.httpStatus);
        warnings.push(`一部メンバーの登録に失敗しました (${statusLabel})`);
        continue;
      }
      await updateMeetingLastError(env.DB, meetingId, toSafeSyncError(error), now().toISOString());
      throw error;
    }
  }

  for (const [emailNorm, existing] of existingByEmail) {
    if (desiredByEmail.has(emailNorm)) continue;
    try {
      await deleteSpaceMember(accessToken, existing.name, fetchFn);
    } catch (error) {
      if (error instanceof GoogleApiError) {
        if (isRetryableGoogleError(error)) {
          await updateMeetingLastError(
            env.DB,
            meetingId,
            toSafeSyncError(error),
            now().toISOString(),
          );
          throw error;
        }
        if (error.httpStatus === 404) continue;
        const statusLabel = error.apiStatus
          ? `${error.httpStatus} ${error.apiStatus}`
          : String(error.httpStatus);
        warnings.push(`一部メンバーの削除に失敗しました (${statusLabel})`);
        continue;
      }
      await updateMeetingLastError(env.DB, meetingId, toSafeSyncError(error), now().toISOString());
      throw error;
    }
  }

  const googleUserUpdates = [...resolvedGoogleUsers.entries()]
    .filter(([emailNorm]) => desiredByEmail.has(emailNorm))
    .map(([emailNormalized, googleUser]) => ({ emailNormalized, googleUser }));
  await updateMeetingInviteeGoogleUsers(env.DB, meetingId, googleUserUpdates);

  if (warnings.length > 0) {
    await updateMeetingLastError(
      env.DB,
      meetingId,
      warnings.join(" / ").slice(0, 400),
      now().toISOString(),
    );
  } else if (meeting.lastError !== null) {
    await updateMeetingLastError(env.DB, meetingId, null, now().toISOString());
  }
}
