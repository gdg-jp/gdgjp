import type { MeetTranscriptEntry } from "~/features/google/meet-stats.server";

export type SessionIntervalInput = {
  startTime: string | null | undefined;
  endTime: string | null | undefined;
};

export type ParticipantAggregationInput = {
  name: string;
  isHostAccount: boolean;
  inviteeEmailNormalized: string | null;
  sessions: readonly SessionIntervalInput[];
};

export type ParticipantAggregationResult = {
  name: string;
  sessionCount: number;
  totalSeconds: number;
};

export type ConferenceAggregationResult = {
  participantCount: number;
  inviteeAttendedCount: number;
  peakConcurrent: number;
  totalAttendanceSeconds: number;
  participants: ParticipantAggregationResult[];
};

export type SpeakerTranscriptDelta = {
  participant: string;
  entryCount: number;
  charCount: number;
  speakingSeconds: number;
};

function toIntervalMs(session: SessionIntervalInput): { startMs: number; endMs: number } | null {
  if (!session.startTime || !session.endTime) return null;
  const startMs = Date.parse(session.startTime);
  const endMs = Date.parse(session.endTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return { startMs, endMs };
}

type IntervalMs = { startMs: number; endMs: number };

function mergeIntervals(sessions: readonly SessionIntervalInput[]): IntervalMs[] {
  const intervals = sessions
    .map(toIntervalMs)
    .filter((item): item is IntervalMs => item !== null)
    .sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.endMs - b.endMs));

  const merged: IntervalMs[] = [];
  for (const next of intervals) {
    const last = merged.at(-1);
    if (last && next.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, next.endMs);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

export function mergeSessionIntervalsSeconds(sessions: readonly SessionIntervalInput[]): number {
  const totalMs = mergeIntervals(sessions).reduce((sum, i) => sum + (i.endMs - i.startMs), 0);
  return Math.round(totalMs / 1000);
}

export function computePeakConcurrent(sessions: readonly SessionIntervalInput[]): number {
  return peakFromIntervals(sessions.map(toIntervalMs).filter((i): i is IntervalMs => i !== null));
}

function peakFromIntervals(intervals: readonly IntervalMs[]): number {
  const events: Array<{ time: number; delta: -1 | 1 }> = [];
  for (const interval of intervals) {
    events.push({ time: interval.startMs, delta: 1 });
    events.push({ time: interval.endMs, delta: -1 });
  }

  if (events.length === 0) return 0;

  events.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.delta - b.delta));

  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    if (current > peak) {
      peak = current;
    }
  }
  return peak;
}

export function aggregateConferenceStats(
  inputs: readonly ParticipantAggregationInput[],
): ConferenceAggregationResult {
  const participantResults: ParticipantAggregationResult[] = inputs.map((p) => ({
    name: p.name,
    sessionCount: p.sessions.length,
    totalSeconds: mergeSessionIntervalsSeconds(p.sessions),
  }));

  const nonHostInputs: ParticipantAggregationInput[] = [];
  const nonHostResultByName = new Map<string, ParticipantAggregationResult>();

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input.isHostAccount) {
      nonHostInputs.push(input);
      nonHostResultByName.set(input.name, participantResults[i]);
    }
  }

  const attendedInviteeEmails = new Set<string>();
  const nonHostIntervals: IntervalMs[] = [];
  let totalAttendanceSeconds = 0;

  for (const p of nonHostInputs) {
    if (p.inviteeEmailNormalized) {
      attendedInviteeEmails.add(p.inviteeEmailNormalized);
    }
    nonHostIntervals.push(...mergeIntervals(p.sessions));
    totalAttendanceSeconds += nonHostResultByName.get(p.name)?.totalSeconds ?? 0;
  }

  return {
    participantCount: nonHostInputs.length,
    inviteeAttendedCount: attendedInviteeEmails.size,
    peakConcurrent: peakFromIntervals(nonHostIntervals),
    totalAttendanceSeconds,
    participants: participantResults,
  };
}

export function aggregateTranscriptEntries(
  entries: readonly MeetTranscriptEntry[],
): SpeakerTranscriptDelta[] {
  const byParticipant = new Map<
    string,
    { entryCount: number; charCount: number; speakingMs: number }
  >();

  for (const entry of entries) {
    const participant = entry.participant?.trim();
    if (!participant) continue;

    const existing = byParticipant.get(participant) ?? {
      entryCount: 0,
      charCount: 0,
      speakingMs: 0,
    };

    existing.entryCount += 1;
    existing.charCount += entry.text ? entry.text.length : 0;

    if (entry.startTime && entry.endTime) {
      const startMs = Date.parse(entry.startTime);
      const endMs = Date.parse(entry.endTime);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        existing.speakingMs += endMs - startMs;
      }
    }

    byParticipant.set(participant, existing);
  }

  return [...byParticipant.entries()].map(([participant, stats]) => ({
    participant,
    entryCount: stats.entryCount,
    charCount: stats.charCount,
    speakingSeconds: Math.round(stats.speakingMs / 1000),
  }));
}
