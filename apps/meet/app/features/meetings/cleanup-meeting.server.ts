import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { normalizeEmail } from "~/features/google/email";
import {
  deleteSpaceMember,
  endActiveConference,
  listSpaceMembers,
  patchSpace,
} from "~/features/google/meet.server";
import { GoogleConnectionError, getGoogleAccessToken } from "~/features/google/token.server";
import { getMeetingById, updateMeetingLastError } from "./meetings.repository.server";

export type CleanupMeetingDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
};

function toSafeCleanupError(error: unknown): string {
  if (error instanceof GoogleConnectionError) {
    return error.message.slice(0, 240);
  }
  if (error instanceof GoogleApiError) {
    const statusLabel = error.apiStatus
      ? `${error.httpStatus} ${error.apiStatus}`
      : String(error.httpStatus);
    return `会議クリーンアップエラー (${statusLabel}): ${error.apiMessage}`.slice(0, 240);
  }
  if (error instanceof Error) {
    return `会議クリーンアップエラー: ${error.message}`.slice(0, 240);
  }
  return "会議クリーンアップ中に予期しないエラーが発生しました";
}

function isRetryableGoogleError(error: GoogleApiError): boolean {
  return error.httpStatus === 429 || error.httpStatus >= 500 || error.httpStatus === 401;
}

function isNoActiveConferenceError(error: GoogleApiError): boolean {
  return (
    error.httpStatus === 404 ||
    error.apiStatus === "NOT_FOUND" ||
    error.apiStatus === "FAILED_PRECONDITION"
  );
}

/**
 * 取り消し済み会議の Meet スペースを後始末する `cleanup_meeting` ジョブ本体。
 * 1. `meetings` を読み、不在・未取り消し・`space_name` 未設定なら終了
 * 2. 登録中の Meet メンバー（共有ホスト自身を除く）を全件削除
 * 3. `spaces.patch` で `accessType` を `RESTRICTED` に戻す
 * 4. `endActiveConference` で進行中会議を終了（進行中会議が無い 404 / FAILED_PRECONDITION は正常扱い）
 * 5. 既に共有済みの Drive ファイル権限には一切触れない
 */
export async function cleanupCanceledMeeting(
  env: Env,
  meetingId: string,
  deps: CleanupMeetingDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  const meeting = await getMeetingById(env.DB, meetingId);
  if (!meeting || meeting.status !== "canceled" || !meeting.spaceName) {
    return;
  }

  const normalizedHostEmail = normalizeEmail(env.GOOGLE_HOST_EMAIL);

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(env, fetchFn);
  } catch (error) {
    await updateMeetingLastError(env.DB, meetingId, toSafeCleanupError(error), now().toISOString());
    throw error;
  }

  let members: Awaited<ReturnType<typeof listSpaceMembers>>;
  try {
    members = await listSpaceMembers(accessToken, meeting.spaceName, fetchFn);
  } catch (error) {
    await updateMeetingLastError(env.DB, meetingId, toSafeCleanupError(error), now().toISOString());
    throw error;
  }

  const warnings: string[] = [];

  for (const member of members) {
    if (member.email && normalizeEmail(member.email) === normalizedHostEmail) {
      continue;
    }
    try {
      await deleteSpaceMember(accessToken, member.name, fetchFn);
    } catch (error) {
      if (error instanceof GoogleApiError) {
        if (error.httpStatus === 404) continue;
        if (isRetryableGoogleError(error)) {
          await updateMeetingLastError(
            env.DB,
            meetingId,
            toSafeCleanupError(error),
            now().toISOString(),
          );
          throw error;
        }
        const statusLabel = error.apiStatus
          ? `${error.httpStatus} ${error.apiStatus}`
          : String(error.httpStatus);
        warnings.push(`一部メンバーの削除に失敗しました (${statusLabel})`);
        continue;
      }
      await updateMeetingLastError(
        env.DB,
        meetingId,
        toSafeCleanupError(error),
        now().toISOString(),
      );
      throw error;
    }
  }

  try {
    await patchSpace(
      accessToken,
      meeting.spaceName,
      { accessType: "RESTRICTED" },
      "config.accessType",
      fetchFn,
    );
  } catch (error) {
    await updateMeetingLastError(env.DB, meetingId, toSafeCleanupError(error), now().toISOString());
    throw error;
  }

  try {
    await endActiveConference(accessToken, meeting.spaceName, fetchFn);
  } catch (error) {
    if (!(error instanceof GoogleApiError && isNoActiveConferenceError(error))) {
      await updateMeetingLastError(
        env.DB,
        meetingId,
        toSafeCleanupError(error),
        now().toISOString(),
      );
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
