import {
  getArtifactByDriveFileId,
  listPendingArtifacts,
  upsertConferenceRecord,
} from "~/features/artifacts/repository.server";
import {
  type EnsureSubscriptionResult,
  ensureSubscription,
} from "~/features/events/subscription.server";
import type { GoogleFetch } from "~/features/google/client.server";
import { getGoogleConnection } from "~/features/google/connection.server";
import {
  listConferenceRecords,
  listRecordings,
  listSmartNotes,
  listTranscripts,
} from "~/features/google/meet.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import type { ArtifactJobKind } from "~/features/jobs/types";
import { listRecentActiveMeetingsWithSpace } from "~/features/meetings/meetings.repository.server";
import {
  ensureTranscriptStatsPending,
  expireStaleConferenceStats,
  expireStaleTranscriptStats,
  listPendingConferenceStatsForCron,
  listPendingTranscriptStatsForCron,
} from "~/features/stats/repository.server";

const BACKFILL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_ARTIFACT_MAX_ATTEMPTS = 20;
const STATS_ENDED_GRACE_MS = 30 * 60 * 1000;
const STATS_STALE_COLLECTING_MS = 2 * 60 * 60 * 1000;
const STATS_MAX_ATTEMPTS = 10;
const STATS_CRON_LIMIT = 20;

export type CronDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
};

export type CronRunSummary = {
  skipped: boolean;
  subscriptionAction: EnsureSubscriptionResult extends { ok: true; action: infer A }
    ? A | "error" | "skipped"
    : string;
  backfilledProcessJobs: number;
  requeuedShareJobs: number;
  enqueuedStatsJobs: number;
  expiredStatsRecords: number;
  errors: string[];
};

export async function runMeetCron(env: Env, deps: CronDeps = {}): Promise<CronRunSummary> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  const connection = await getGoogleConnection(env.DB);
  if (!connection || connection.status !== "connected") {
    return {
      skipped: true,
      subscriptionAction: "skipped",
      backfilledProcessJobs: 0,
      requeuedShareJobs: 0,
      enqueuedStatsJobs: 0,
      expiredStatsRecords: 0,
      errors: [],
    };
  }

  const errors: string[] = [];
  let subscriptionAction: CronRunSummary["subscriptionAction"] = "skipped";
  let enqueuedStatsJobs = 0;
  let expiredStatsRecords = 0;
  const enqueuedTranscripts = new Set<string>();

  try {
    const ensured = await ensureSubscription(env, { fetchFn, now });
    subscriptionAction = ensured.ok ? ensured.action : "skipped";
  } catch (error) {
    subscriptionAction = "error";
    console.error("[meet-cron] ensureSubscription failed:", error);
    errors.push(error instanceof Error ? error.message : String(error));
  }

  let backfilledProcessJobs = 0;
  try {
    const nowDate = now();
    const sinceEndAtIso = new Date(nowDate.getTime() - BACKFILL_LOOKBACK_MS).toISOString();
    const meetings = await listRecentActiveMeetingsWithSpace(env.DB, {
      sinceEndAtIso,
      nowIso: nowDate.toISOString(),
    });

    if (meetings.length > 0) {
      const accessToken = await getGoogleAccessToken(env, fetchFn);
      const seenFileIds = new Set<string>();

      for (const meeting of meetings) {
        if (!meeting.spaceName) continue;
        try {
          const records = await listConferenceRecords(
            accessToken,
            `space.name="${meeting.spaceName}"`,
            fetchFn,
          );
          for (const record of records) {
            await upsertConferenceRecord(env.DB, {
              name: record.name,
              meetingId: meeting.id,
              startTime: record.startTime ?? null,
              endTime: record.endTime ?? null,
              expireTime: record.expireTime ?? null,
            });

            const [recordings, transcripts, smartNotes] = await Promise.all([
              listRecordings(accessToken, record.name, fetchFn),
              listTranscripts(accessToken, record.name, fetchFn),
              listSmartNotes(accessToken, record.name, fetchFn),
            ]);

            const candidates: Array<{
              kind: ArtifactJobKind;
              resourceName: string;
              fileId: string;
            }> = [];

            for (const rec of recordings) {
              if (rec.state === "FILE_GENERATED" && rec.driveDestination?.file) {
                candidates.push({
                  kind: "recording",
                  resourceName: rec.name,
                  fileId: rec.driveDestination.file,
                });
              }
            }
            for (const tr of transcripts) {
              if (tr.state === "FILE_GENERATED") {
                const ts = await ensureTranscriptStatsPending(env.DB, tr.name, record.name);
                if (
                  (ts.status === "pending" || ts.status === "failed") &&
                  ts.attempts < STATS_MAX_ATTEMPTS &&
                  !enqueuedTranscripts.has(tr.name)
                ) {
                  await env.MEET_JOBS.send({
                    type: "collect_transcript_stats",
                    conferenceRecord: record.name,
                    transcript: tr.name,
                  });
                  enqueuedTranscripts.add(tr.name);
                  enqueuedStatsJobs += 1;
                }
                if (tr.docsDestination?.document) {
                  candidates.push({
                    kind: "transcript",
                    resourceName: tr.name,
                    fileId: tr.docsDestination.document,
                  });
                }
              }
            }
            for (const sn of smartNotes) {
              if (sn.state === "FILE_GENERATED" && sn.docsDestination?.document) {
                candidates.push({
                  kind: "smartNote",
                  resourceName: sn.name,
                  fileId: sn.docsDestination.document,
                });
              }
            }

            for (const candidate of candidates) {
              if (seenFileIds.has(candidate.fileId)) continue;
              const existing = await getArtifactByDriveFileId(env.DB, candidate.fileId);
              if (existing) {
                seenFileIds.add(candidate.fileId);
                continue;
              }
              seenFileIds.add(candidate.fileId);
              await env.MEET_JOBS.send({
                type: "process_artifact",
                meetingId: meeting.id,
                kind: candidate.kind,
                conferenceRecord: record.name,
                resourceName: candidate.resourceName,
              });
              backfilledProcessJobs += 1;
            }
          }
        } catch (error) {
          console.error("[meet-cron] backfill failed for meeting:", meeting.id, error);
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
  } catch (error) {
    console.error("[meet-cron] backfill stage failed:", error);
    errors.push(error instanceof Error ? error.message : String(error));
  }

  let requeuedShareJobs = 0;
  try {
    const pendingArtifacts = await listPendingArtifacts(env.DB, PENDING_ARTIFACT_MAX_ATTEMPTS);
    for (const artifact of pendingArtifacts) {
      await env.MEET_JOBS.send({ type: "share_artifact", artifactId: artifact.id });
      requeuedShareJobs += 1;
    }
  } catch (error) {
    console.error("[meet-cron] pending artifact requeue failed:", error);
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const nowDate = now();
    const nowIso = nowDate.toISOString();
    const endedBeforeIso = new Date(nowDate.getTime() - STATS_ENDED_GRACE_MS).toISOString();

    const expiredConferences = await expireStaleConferenceStats(env.DB, nowIso);
    const expiredTranscripts = await expireStaleTranscriptStats(env.DB, nowIso);
    expiredStatsRecords = expiredConferences + expiredTranscripts;

    const pendingConferences = await listPendingConferenceStatsForCron(env.DB, {
      endedBeforeIso,
      staleCollectingBeforeIso: new Date(
        nowDate.getTime() - STATS_STALE_COLLECTING_MS,
      ).toISOString(),
      nowIso,
      maxAttempts: STATS_MAX_ATTEMPTS,
      limit: STATS_CRON_LIMIT,
    });
    for (const conferenceRecord of pendingConferences) {
      await env.MEET_JOBS.send({ type: "collect_conference_stats", conferenceRecord });
      enqueuedStatsJobs += 1;
    }

    const pendingTranscripts = await listPendingTranscriptStatsForCron(env.DB, {
      nowIso,
      maxAttempts: STATS_MAX_ATTEMPTS,
      limit: STATS_CRON_LIMIT,
    });
    for (const item of pendingTranscripts) {
      if (enqueuedTranscripts.has(item.transcript)) continue;
      await env.MEET_JOBS.send({
        type: "collect_transcript_stats",
        conferenceRecord: item.conferenceRecord,
        transcript: item.transcript,
      });
      enqueuedTranscripts.add(item.transcript);
      enqueuedStatsJobs += 1;
    }
  } catch (error) {
    console.error("[meet-cron] stats maintenance failed:", error);
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    skipped: false,
    subscriptionAction,
    backfilledProcessJobs,
    requeuedShareJobs,
    enqueuedStatsJobs,
    expiredStatsRecords,
    errors,
  };
}
