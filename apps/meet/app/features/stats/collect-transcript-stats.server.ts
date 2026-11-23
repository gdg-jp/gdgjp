import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { getGoogleConnection } from "~/features/google/connection.server";
import { toSafeErrorSummary } from "~/features/google/error-summary.server";
import { listTranscriptEntries } from "~/features/google/meet.server";
import {
  STATS_MAX_CALLS_PER_JOB,
  STATS_MIN_INTERVAL_MS,
  createPacer,
} from "~/features/google/pacer.server";
import { GoogleConnectionError, getGoogleAccessToken } from "~/features/google/token.server";
import { maskEmailsInText } from "~/lib/redact-email";
import { aggregateTranscriptEntries } from "./aggregate";
import {
  getConferenceRecordForStats,
  getTranscriptStats,
  incrementTranscriptStatsAttempts,
  saveTranscriptStatsPageBatch,
  setTranscriptStatsTerminal,
} from "./repository.server";

export type CollectTranscriptStatsInput = {
  conferenceRecord: string;
  transcript: string;
  pageToken?: string;
};

export type CollectTranscriptStatsDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
  minIntervalMs?: number;
  maxCalls?: number;
  sleep?: (ms: number) => Promise<void>;
};

const BUDGET_CONTINUATION_DELAY_SECONDS = 30;

function isExpiredAt(expireTime: string | null | undefined, now: Date): boolean {
  if (!expireTime) return false;
  const ms = Date.parse(expireTime);
  return Number.isFinite(ms) && ms <= now.getTime();
}

/**
 * `collect_transcript_stats` ジョブ本体。
 * 文字起こし本文（`text`）は保存せず文字数のみを加算して破棄し、1 ジョブ最大 100 ページまで処理する。
 */
export async function collectTranscriptStatsJob(
  env: Env,
  input: CollectTranscriptStatsInput,
  deps: CollectTranscriptStatsDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const nowDate = now();

  const existing = await getTranscriptStats(env.DB, input.transcript);
  if (!existing) return;
  if (existing.status === "collected" || existing.status === "expired") {
    return;
  }

  const record = await getConferenceRecordForStats(env.DB, input.conferenceRecord);
  if (!record) return;
  if (isExpiredAt(record.expireTime, nowDate)) {
    await setTranscriptStatsTerminal(env.DB, input.transcript, "expired", null);
    return;
  }

  const pacer = createPacer({
    minIntervalMs: deps.minIntervalMs ?? STATS_MIN_INTERVAL_MS,
    maxCalls: deps.maxCalls ?? STATS_MAX_CALLS_PER_JOB,
    sleep: deps.sleep,
  });

  try {
    const connection = await getGoogleConnection(env.DB);
    if (!connection || connection.status !== "connected") {
      throw new GoogleConnectionError(
        "not_connected",
        "共有 Google アカウントが接続されていません",
      );
    }
    const accessToken = await getGoogleAccessToken(env, fetchFn);

    const isInitialJob = input.pageToken === undefined;
    if (isInitialJob) {
      await incrementTranscriptStatsAttempts(env.DB, input.transcript);
    }

    let currentPageToken = input.pageToken;
    const collectedEntries = [];

    while (true) {
      if (!(await pacer.next())) {
        const deltas = aggregateTranscriptEntries(collectedEntries);
        await saveTranscriptStatsPageBatch(env.DB, {
          transcript: input.transcript,
          clearExisting: isInitialJob,
          deltas,
        });
        await env.MEET_JOBS.send(
          {
            type: "collect_transcript_stats",
            conferenceRecord: input.conferenceRecord,
            transcript: input.transcript,
            ...(currentPageToken ? { pageToken: currentPageToken } : {}),
          },
          { delaySeconds: BUDGET_CONTINUATION_DELAY_SECONDS },
        );
        return;
      }

      const page = await listTranscriptEntries(
        accessToken,
        input.transcript,
        { pageToken: currentPageToken },
        fetchFn,
      );
      if (page.transcriptEntries.length > 0) {
        collectedEntries.push(...page.transcriptEntries);
      }

      if (!page.nextPageToken) {
        const deltas = aggregateTranscriptEntries(collectedEntries);
        await saveTranscriptStatsPageBatch(env.DB, {
          transcript: input.transcript,
          clearExisting: isInitialJob,
          deltas,
          collectedAt: now().toISOString(),
        });
        return;
      }
      currentPageToken = page.nextPageToken;
    }
  } catch (error) {
    if (error instanceof GoogleApiError && error.retryable) {
      throw error;
    }
    if (error instanceof GoogleConnectionError && error.code === "refresh_failed") {
      throw error;
    }
    const safeSummary = maskEmailsInText(toSafeErrorSummary(error));
    await setTranscriptStatsTerminal(env.DB, input.transcript, "failed", safeSummary);
  }
}
