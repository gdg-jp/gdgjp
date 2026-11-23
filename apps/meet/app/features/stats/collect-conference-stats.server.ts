import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { getGoogleConnection } from "~/features/google/connection.server";
import { normalizeEmail } from "~/features/google/email";
import { toSafeErrorSummary } from "~/features/google/error-summary.server";
import {
  type MeetParticipant,
  getConferenceRecord,
  listParticipantSessions,
  listParticipants,
  listSpaceMembers,
  memberUserId,
} from "~/features/google/meet.server";
import {
  STATS_MAX_CALLS_PER_JOB,
  STATS_MIN_INTERVAL_MS,
  createPacer,
} from "~/features/google/pacer.server";
import { GoogleConnectionError, getGoogleAccessToken } from "~/features/google/token.server";
import {
  getMeetingById,
  listMeetingInvitees,
  updateMeetingInviteeGoogleUsers,
} from "~/features/meetings/meetings.repository.server";
import { maskEmailsInText } from "~/lib/redact-email";
import { aggregateConferenceStats } from "./aggregate";
import {
  getConferenceRecordForStats,
  listConferenceParticipantSessions,
  listConferenceParticipants,
  saveConferenceStatsCollected,
  setConferenceStatsStatus,
  startConferenceStatsCollecting,
  updateConferenceRecordTimes,
  upsertConferenceParticipantSessions,
  upsertConferenceParticipants,
} from "./repository.server";
import type { ConferenceParticipantKind } from "./stats";

export type CollectConferenceStatsInput = {
  conferenceRecord: string;
  cursor?: string;
};

export type CollectConferenceStatsDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
  minIntervalMs?: number;
  maxCalls?: number;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_STATS_ATTEMPTS = 10;
const ONGOING_REQUEUE_DELAY_SECONDS = 600;
const OPEN_SESSION_REQUEUE_DELAY_SECONDS = 300;
const BUDGET_CONTINUATION_DELAY_SECONDS = 30;

function isExpiredAt(expireTime: string | null | undefined, now: Date): boolean {
  if (!expireTime) return false;
  const ms = Date.parse(expireTime);
  return Number.isFinite(ms) && ms <= now.getTime();
}

function mapMeetParticipantKind(participant: MeetParticipant): {
  kind: ConferenceParticipantKind;
  googleUser: string | null;
  displayName: string | null;
} {
  if (participant.signedinUser) {
    return {
      kind: "signedin",
      googleUser: participant.signedinUser.user?.trim() || null,
      displayName: participant.signedinUser.displayName?.trim() || null,
    };
  }
  if (participant.anonymousUser) {
    return {
      kind: "anonymous",
      googleUser: null,
      displayName: participant.anonymousUser.displayName?.trim() || null,
    };
  }
  if (participant.phoneUser) {
    return {
      kind: "phone",
      googleUser: null,
      displayName: participant.phoneUser.displayName?.trim() || null,
    };
  }
  return { kind: "anonymous", googleUser: null, displayName: null };
}

export async function collectConferenceStatsJob(
  env: Env,
  input: CollectConferenceStatsInput,
  deps: CollectConferenceStatsDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const nowDate = now();

  const record = await getConferenceRecordForStats(env.DB, input.conferenceRecord);
  if (!record) return;

  if (
    record.statsStatus === "collected" ||
    record.statsStatus === "skipped" ||
    record.statsStatus === "expired"
  ) {
    return;
  }

  if (isExpiredAt(record.expireTime, nowDate)) {
    await setConferenceStatsStatus(env.DB, record.name, "expired", null);
    return;
  }

  const meeting = await getMeetingById(env.DB, record.meetingId);
  if (!meeting) return;

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
    const hostGoogleUser = connection.google_user_id ? `users/${connection.google_user_id}` : null;

    if (input.cursor === undefined) {
      await startConferenceStatsCollecting(env.DB, record.name);
      const nextAttempts = record.statsAttempts + 1;

      if (!(await pacer.next())) {
        await env.MEET_JOBS.send(
          { type: "collect_conference_stats", conferenceRecord: record.name },
          { delaySeconds: BUDGET_CONTINUATION_DELAY_SECONDS },
        );
        return;
      }

      const remoteRecord = await getConferenceRecord(accessToken, record.name, fetchFn);
      await updateConferenceRecordTimes(env.DB, record.name, {
        startTime: remoteRecord.startTime ?? null,
        endTime: remoteRecord.endTime ?? null,
        expireTime: remoteRecord.expireTime ?? null,
      });

      if (isExpiredAt(remoteRecord.expireTime, nowDate)) {
        await setConferenceStatsStatus(env.DB, record.name, "expired", null);
        return;
      }

      if (!remoteRecord.endTime) {
        if (nextAttempts >= MAX_STATS_ATTEMPTS) {
          await setConferenceStatsStatus(
            env.DB,
            record.name,
            "failed",
            "会議の終了時刻が確定しませんでした",
          );
          return;
        }
        await setConferenceStatsStatus(env.DB, record.name, "pending", null);
        await env.MEET_JOBS.send(
          { type: "collect_conference_stats", conferenceRecord: record.name },
          { delaySeconds: ONGOING_REQUEUE_DELAY_SECONDS },
        );
        return;
      }

      if (!(await pacer.next())) {
        await env.MEET_JOBS.send(
          { type: "collect_conference_stats", conferenceRecord: record.name },
          { delaySeconds: BUDGET_CONTINUATION_DELAY_SECONDS },
        );
        return;
      }

      const participants = await listParticipants(accessToken, record.name, fetchFn);
      if (participants.length === 0) {
        await setConferenceStatsStatus(env.DB, record.name, "skipped", null);
        return;
      }

      if (participants.some((p) => !p.latestEndTime)) {
        if (nextAttempts >= MAX_STATS_ATTEMPTS) {
          await setConferenceStatsStatus(
            env.DB,
            record.name,
            "failed",
            "一部参加者の退室時刻が確定しませんでした",
          );
          return;
        }
        await setConferenceStatsStatus(env.DB, record.name, "pending", null);
        await env.MEET_JOBS.send(
          { type: "collect_conference_stats", conferenceRecord: record.name },
          { delaySeconds: OPEN_SESSION_REQUEUE_DELAY_SECONDS },
        );
        return;
      }

      let invitees = await listMeetingInvitees(env.DB, meeting.id);
      if (
        meeting.status === "active" &&
        meeting.spaceName &&
        invitees.some((inv) => !inv.googleUser)
      ) {
        if (!(await pacer.next())) {
          await env.MEET_JOBS.send(
            { type: "collect_conference_stats", conferenceRecord: record.name },
            { delaySeconds: BUDGET_CONTINUATION_DELAY_SECONDS },
          );
          return;
        }
        const members = await listSpaceMembers(accessToken, meeting.spaceName, fetchFn);
        const userByEmail = new Map<string, string | null>();
        for (const member of members) {
          if (!member.email) continue;
          const norm = normalizeEmail(member.email);
          if (norm) userByEmail.set(norm, memberUserId(member.name));
        }
        const updates: Array<{ emailNormalized: string; googleUser: string | null }> = [];
        invitees = invitees.map((inv) => {
          if (!userByEmail.has(inv.emailNormalized)) return inv;
          const resolved = userByEmail.get(inv.emailNormalized) ?? null;
          updates.push({ emailNormalized: inv.emailNormalized, googleUser: resolved });
          return { ...inv, googleUser: resolved };
        });
        await updateMeetingInviteeGoogleUsers(env.DB, meeting.id, updates);
      }

      const emailByGoogleUser = new Map<string, string>();
      for (const inv of invitees) {
        if (inv.googleUser) {
          emailByGoogleUser.set(inv.googleUser, inv.emailNormalized);
        }
      }

      await upsertConferenceParticipants(
        env.DB,
        participants.map((p) => {
          const mapped = mapMeetParticipantKind(p);
          const isHostAccount = Boolean(
            mapped.googleUser && hostGoogleUser && mapped.googleUser === hostGoogleUser,
          );
          const inviteeEmailNormalized =
            !isHostAccount && mapped.googleUser
              ? (emailByGoogleUser.get(mapped.googleUser) ?? null)
              : null;
          return {
            name: p.name,
            conferenceRecord: record.name,
            meetingId: meeting.id,
            kind: mapped.kind,
            googleUser: mapped.googleUser,
            displayName: mapped.displayName,
            isHostAccount,
            inviteeEmailNormalized,
            earliestStartTime: p.earliestStartTime ?? null,
            latestEndTime: p.latestEndTime ?? null,
          };
        }),
      );
    }

    const allParticipants = (await listConferenceParticipants(env.DB, record.name)).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    const cursor = input.cursor;
    const remaining =
      cursor === undefined ? allParticipants : allParticipants.filter((p) => p.name > cursor);

    let lastCompletedName = cursor;
    for (const participant of remaining) {
      if (!(await pacer.next())) {
        await env.MEET_JOBS.send(
          {
            type: "collect_conference_stats",
            conferenceRecord: record.name,
            cursor: lastCompletedName ?? "",
          },
          { delaySeconds: BUDGET_CONTINUATION_DELAY_SECONDS },
        );
        return;
      }

      const sessions = await listParticipantSessions(accessToken, participant.name, fetchFn);
      await upsertConferenceParticipantSessions(
        env.DB,
        participant.name,
        sessions.map((s) => ({
          name: s.name,
          startTime: s.startTime ?? null,
          endTime: s.endTime ?? null,
        })),
      );
      lastCompletedName = participant.name;
    }

    const allSessions = await listConferenceParticipantSessions(env.DB, record.name);
    const sessionsByParticipant = new Map<
      string,
      Array<{ startTime: string | null; endTime: string | null }>
    >();
    for (const session of allSessions) {
      const list = sessionsByParticipant.get(session.participant) ?? [];
      list.push({ startTime: session.startTime, endTime: session.endTime });
      sessionsByParticipant.set(session.participant, list);
    }

    const aggregation = aggregateConferenceStats(
      allParticipants.map((p) => ({
        name: p.name,
        isHostAccount: p.isHostAccount,
        inviteeEmailNormalized: p.inviteeEmailNormalized,
        sessions: sessionsByParticipant.get(p.name) ?? [],
      })),
    );
    await saveConferenceStatsCollected(env.DB, record.name, aggregation, now().toISOString());
  } catch (error) {
    if (error instanceof GoogleApiError && error.retryable) {
      throw error;
    }
    if (error instanceof GoogleConnectionError && error.code === "refresh_failed") {
      throw error;
    }
    const safeSummary = maskEmailsInText(toSafeErrorSummary(error));
    await setConferenceStatsStatus(env.DB, record.name, "failed", safeSummary);
  }
}
