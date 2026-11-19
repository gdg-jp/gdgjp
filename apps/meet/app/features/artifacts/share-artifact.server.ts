import { getEvent, patchEvent } from "~/features/google/calendar.server";
import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { createPermission, listPermissions } from "~/features/google/drive.server";
import { normalizeEmail } from "~/features/google/email";
import { getGoogleAccessToken } from "~/features/google/token.server";
import { toSafeErrorSummary } from "~/features/meetings/invite-resolution.server";
import {
  getMeetingById,
  listMeetingInvitees,
} from "~/features/meetings/meetings.repository.server";
import { getCalendarAttachmentTitle } from "./artifact";
import {
  getArtifactById,
  markArtifactAttached,
  markArtifactShared,
  recordArtifactAttemptError,
} from "./repository.server";

export type ShareArtifactDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
};

const DRIVE_RATE_LIMIT_PATTERN =
  /sharingRateLimitExceeded|userRateLimitExceeded|rateLimitExceeded/i;

function isDriveRateLimitError(error: GoogleApiError): boolean {
  return (
    (error.apiStatus !== undefined && DRIVE_RATE_LIMIT_PATTERN.test(error.apiStatus)) ||
    DRIVE_RATE_LIMIT_PATTERN.test(error.apiMessage)
  );
}

function isRetryableDriveError(error: GoogleApiError): boolean {
  if (error.httpStatus === 429 || error.httpStatus >= 500 || error.httpStatus === 401) {
    return true;
  }
  return error.httpStatus === 403 && isDriveRateLimitError(error);
}

function isPermanentInviteeShareError(error: GoogleApiError): boolean {
  if (isRetryableDriveError(error)) return false;
  return error.httpStatus === 400 || error.httpStatus === 403;
}

function isAlreadyAttached(
  attachments: ReadonlyArray<{ fileUrl?: string; fileId?: string }>,
  webViewLink: string,
  driveFileId: string,
): boolean {
  return attachments.some((att) => {
    if (att.fileId && att.fileId === driveFileId) return true;
    if (!att.fileUrl) return false;
    return att.fileUrl === webViewLink || att.fileUrl.includes(driveFileId);
  });
}

/**
 * `share_artifact` ジョブ本体（`MEET_JOBS` コンシューマの `max_concurrency = 1` で直列実行）。
 * 1. Drive 既存権限を正規化メールで突合し、未共有の招待者だけへ 1 件ずつ `reader` 共有（通知メールなし）
 * 2. Calendar 予定の既存 `attachments` を保持したまま末尾に追記して `sendUpdates=none` で `patchEvent`
 *    （`attachments` 以外のフィールドは一切変更しない）
 */
export async function shareArtifactJob(
  env: Env,
  artifactId: string,
  deps: ShareArtifactDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  const artifact = await getArtifactById(env.DB, artifactId);
  if (!artifact) return;

  const meeting = await getMeetingById(env.DB, artifact.meetingId);
  if (!meeting || meeting.status === "canceled") return;

  const invitees = await listMeetingInvitees(env.DB, meeting.id);
  const normalizedHostEmail = normalizeEmail(env.GOOGLE_HOST_EMAIL);

  try {
    const accessToken = await getGoogleAccessToken(env, fetchFn);

    // 1. Drive 閲覧権限の付与（既存権限は変更・削除しない）
    const existingPermissions = await listPermissions(accessToken, artifact.driveFileId, fetchFn);
    const sharedNormalizedEmails = new Set<string>();
    for (const perm of existingPermissions) {
      if (perm.emailAddress) {
        sharedNormalizedEmails.add(normalizeEmail(perm.emailAddress));
      }
    }

    const permanentWarnings: string[] = [];
    for (const invitee of invitees) {
      if (invitee.emailNormalized === normalizedHostEmail) continue;
      if (sharedNormalizedEmails.has(invitee.emailNormalized)) continue;

      try {
        await createPermission(
          accessToken,
          artifact.driveFileId,
          {
            type: "user",
            role: "reader",
            emailAddress: invitee.email,
            sendNotificationEmail: false,
          },
          fetchFn,
        );
        sharedNormalizedEmails.add(invitee.emailNormalized);
      } catch (error) {
        if (error instanceof GoogleApiError && isPermanentInviteeShareError(error)) {
          // 1 人の恒久エラーで他の招待者への共有を止めない。個人メールは last_error に含めない。
          const statusLabel = error.apiStatus
            ? `${error.httpStatus} ${error.apiStatus}`
            : String(error.httpStatus);
          permanentWarnings.push(`一部招待者への Drive 共有をスキップしました (${statusLabel})`);
          continue;
        }
        throw error;
      }
    }

    const warningSummary =
      permanentWarnings.length > 0 ? permanentWarnings.join(" / ").slice(0, 400) : null;
    await markArtifactShared(env.DB, artifact.id, now().toISOString(), warningSummary);

    // 2. Calendar 予定への添付（既存 attachments を保持し、attachments 以外は変更しない）
    if (meeting.calendarEventId && artifact.attachedAt === null) {
      const event = await getEvent(
        accessToken,
        { calendarId: "primary", eventId: meeting.calendarEventId },
        fetchFn,
      );
      const currentAttachments = event.attachments ?? [];
      if (!isAlreadyAttached(currentAttachments, artifact.webViewLink, artifact.driveFileId)) {
        const nextAttachments = [
          ...currentAttachments,
          {
            fileUrl: artifact.webViewLink,
            // Drive の実ファイル名は Meet 生成時のまま保持し、Calendar 上の表示名のみ種別ごとの短い名称にする。
            title: getCalendarAttachmentTitle(artifact.kind),
            mimeType: artifact.mimeType,
          },
        ];
        await patchEvent(
          accessToken,
          {
            calendarId: "primary",
            eventId: meeting.calendarEventId,
            supportsAttachments: true,
            sendUpdates: "none",
            body: { attachments: nextAttachments },
          },
          fetchFn,
        );
      }
      await markArtifactAttached(env.DB, artifact.id, now().toISOString());
    }
  } catch (error) {
    await recordArtifactAttemptError(env.DB, artifact.id, toSafeErrorSummary(error));
    throw error;
  }
}
