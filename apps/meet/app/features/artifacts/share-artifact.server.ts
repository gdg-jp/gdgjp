import { getEvent, patchEvent } from "~/features/google/calendar.server";
import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import {
  createPermission,
  isInvalidSharingRequestError,
  listPermissions,
} from "~/features/google/drive.server";
import { normalizeEmail } from "~/features/google/email";
import { toSafeErrorSummary } from "~/features/google/error-summary.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import { upsertDriveShareCheck } from "~/features/invitee-checks/repository.server";
import {
  getMeetingById,
  listMeetingInvitees,
} from "~/features/meetings/meetings.repository.server";
import { maskEmail, maskEmailsInText } from "~/lib/redact-email";
import { getCalendarAttachmentTitle } from "./artifact";
import {
  deleteArtifactShareFailuresForEmails,
  getArtifactById,
  listArtifactShareFailureEmails,
  markArtifactAttached,
  markArtifactShared,
  recordArtifactAttemptError,
  upsertArtifactShareFailure,
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

    const existingPermissions = await listPermissions(accessToken, artifact.driveFileId, fetchFn);
    const sharedNormalizedEmails = new Set<string>();
    for (const perm of existingPermissions) {
      if (perm.emailAddress) {
        sharedNormalizedEmails.add(normalizeEmail(perm.emailAddress));
      }
    }

    const permanentWarnings: string[] = [];
    const clearedFailureEmails: string[] = [];
    const failedFailureEmails = new Set<string>();

    for (const invitee of invitees) {
      if (invitee.emailNormalized === normalizedHostEmail) continue;
      if (sharedNormalizedEmails.has(invitee.emailNormalized)) {
        clearedFailureEmails.push(invitee.emailNormalized);
        continue;
      }

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
        clearedFailureEmails.push(invitee.emailNormalized);
      } catch (error) {
        if (error instanceof GoogleApiError && isPermanentInviteeShareError(error)) {
          const failedAt = now().toISOString();
          failedFailureEmails.add(invitee.emailNormalized);
          await upsertArtifactShareFailure(env.DB, {
            artifactId: artifact.id,
            emailNormalized: invitee.emailNormalized,
            httpStatus: error.httpStatus,
            apiStatus: error.apiStatus ?? null,
            failedAt,
          });
          if (isInvalidSharingRequestError(error)) {
            await upsertDriveShareCheck(env.DB, {
              emailNormalized: invitee.emailNormalized,
              status: "unshareable",
              httpStatus: error.httpStatus,
              apiStatus: error.apiStatus ?? null,
              source: "share",
              checkedAt: failedAt,
            });
          }
          console.warn("[share-artifact] invitee share failed:", {
            artifactId: artifact.id,
            email: maskEmail(invitee.email),
            status: error.httpStatus,
            apiStatus: error.apiStatus ?? null,
            apiMessage: maskEmailsInText(error.apiMessage),
          });

          const statusLabel = error.apiStatus
            ? `${error.httpStatus} ${error.apiStatus}`
            : String(error.httpStatus);
          permanentWarnings.push(`一部招待者への Drive 共有をスキップしました (${statusLabel})`);
          continue;
        }
        throw error;
      }
    }

    const existingFailureEmails = await listArtifactShareFailureEmails(env.DB, artifact.id);
    const staleFailureEmails = existingFailureEmails.filter(
      (email) => !failedFailureEmails.has(email),
    );
    await deleteArtifactShareFailuresForEmails(env.DB, artifact.id, [
      ...clearedFailureEmails,
      ...staleFailureEmails,
    ]);

    const warningSummary =
      permanentWarnings.length > 0 ? permanentWarnings.join(" / ").slice(0, 400) : null;
    await markArtifactShared(env.DB, artifact.id, now().toISOString(), warningSummary);

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
