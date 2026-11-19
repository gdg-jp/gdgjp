import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { normalizeEmail } from "~/features/google/email";
import {
  type MeetMemberRole,
  createSpaceMember,
  deleteSpaceMember,
  listSpaceMembers,
} from "~/features/google/meet.server";
import { GoogleConnectionError, getGoogleAccessToken } from "~/features/google/token.server";
import type { InviteeRole } from "./meeting";
import {
  getMeetingById,
  listMeetingInvitees,
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

/**
 * Meet スペースのメンバーを D1 の `meeting_invitees` と冪等に同期する。
 * - `meeting` 不在・`canceled`・`space_name` 空の場合は何もしない
 * - 役割まで一致している既存メンバーには書き込み API を呼ばない
 * - 役割が異なるメンバーは `members.delete` → `members.create` で置き換える
 * - 429 / 5xx / 401 / ネットワークエラー / `invalid_grant` は `meetings.last_error` を残して再スローし Queue 再試行に回す
 * - 特定メンバーの恒久的 4xx は他メンバーの同期を止めず警告を `meetings.last_error` に残して継続する
 */
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
  for (const member of existingMembers) {
    if (!member.email) continue;
    const norm = normalizeEmail(member.email);
    if (!norm || norm === normalizedHostEmail) continue;
    existingByEmail.set(norm, {
      name: member.name,
      role: member.role === "COHOST" ? "cohost" : "participant",
    });
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

  // 追加および役割変更（delete → create）
  for (const [emailNorm, desired] of desiredByEmail) {
    const existing = existingByEmail.get(emailNorm);
    const meetRole: MeetMemberRole | undefined = desired.role === "cohost" ? "COHOST" : undefined;

    if (existing && existing.role === desired.role) {
      // 役割まで一致しているメンバーには書き込み API を一切呼ばない。
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
      await createSpaceMember(
        accessToken,
        meeting.spaceName,
        { email: desired.email, role: meetRole },
        fetchFn,
      );
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
        // 既に存在する（409）場合は冪等成功として扱う。
        if (error.httpStatus === 409) continue;
        // 恒久的 4xx は他メンバーの同期を止めない。個人メールアドレスは last_error に含めない。
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

  // 不要になった既存メンバーの削除
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
