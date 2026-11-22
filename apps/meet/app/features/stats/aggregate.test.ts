import { describe, expect, it } from "vitest";
import {
  aggregateConferenceStats,
  aggregateTranscriptEntries,
  computePeakConcurrent,
  mergeSessionIntervalsSeconds,
} from "./aggregate";

describe("mergeSessionIntervalsSeconds", () => {
  it("重なり合う・連続するセッション区間を統合して二重計上しない", () => {
    const total = mergeSessionIntervalsSeconds([
      { startTime: "2026-11-19T10:00:00.000Z", endTime: "2026-11-19T10:10:00.000Z" },
      // 10:05〜10:15 は前の区間と 5 分重複 → 統合して 10:00〜10:15 (900 秒)
      { startTime: "2026-11-19T10:05:00.000Z", endTime: "2026-11-19T10:15:00.000Z" },
      // 10:20〜10:21 (60 秒)
      { startTime: "2026-11-19T10:20:00.000Z", endTime: "2026-11-19T10:21:00.000Z" },
      // endTime 欠損や 0 秒は無視
      { startTime: "2026-11-19T10:30:00.000Z", endTime: null },
      { startTime: "2026-11-19T10:30:00.000Z", endTime: "2026-11-19T10:30:00.000Z" },
    ]);
    expect(total).toBe(960);
  });
});

describe("computePeakConcurrent", () => {
  it("同時刻の同着（end == start）は退室を先に数え、重複して増えない", () => {
    const peak = computePeakConcurrent([
      { startTime: "2026-11-19T10:00:00.000Z", endTime: "2026-11-19T10:10:00.000Z" },
      // 10:10:00 ちょうどに入室 → 先の退室が先に処理されるためピークは 1 のまま
      { startTime: "2026-11-19T10:10:00.000Z", endTime: "2026-11-19T10:20:00.000Z" },
    ]);
    expect(peak).toBe(1);
  });

  it("実際に重なる時間帯の最大同時接続数を算出する", () => {
    const peak = computePeakConcurrent([
      { startTime: "2026-11-19T10:00:00.000Z", endTime: "2026-11-19T10:30:00.000Z" },
      { startTime: "2026-11-19T10:05:00.000Z", endTime: "2026-11-19T10:20:00.000Z" },
      { startTime: "2026-11-19T10:10:00.000Z", endTime: "2026-11-19T10:15:00.000Z" },
    ]);
    expect(peak).toBe(3);
  });
});

describe("aggregateConferenceStats", () => {
  it("共有ホストアカウントを participant_count・peak_concurrent・出席数・総滞在時間から除外する", () => {
    const result = aggregateConferenceStats([
      {
        name: "conferenceRecords/cr-1/participants/host",
        isHostAccount: true,
        inviteeEmailNormalized: null,
        sessions: [{ startTime: "2026-11-19T10:00:00.000Z", endTime: "2026-11-19T11:00:00.000Z" }],
      },
      {
        name: "conferenceRecords/cr-1/participants/u1",
        isHostAccount: false,
        inviteeEmailNormalized: "a@example.com",
        sessions: [
          { startTime: "2026-11-19T10:00:00.000Z", endTime: "2026-11-19T10:20:00.000Z" },
          { startTime: "2026-11-19T10:10:00.000Z", endTime: "2026-11-19T10:30:00.000Z" },
        ],
      },
      {
        name: "conferenceRecords/cr-1/participants/u2",
        isHostAccount: false,
        inviteeEmailNormalized: null,
        sessions: [{ startTime: "2026-11-19T10:40:00.000Z", endTime: "2026-11-19T10:50:00.000Z" }],
      },
    ]);

    expect(result.participantCount).toBe(2);
    expect(result.inviteeAttendedCount).toBe(1);
    // ホスト除外。u1 は 10:10-10:20 に 2 端末で同時接続しているが 1 人と数える。
    // u2 は u1 と重ならないため、ピークは 1
    expect(result.peakConcurrent).toBe(1);
    // u1: 30分 (1800秒) + u2: 10分 (600秒) = 2400秒（ホストの 3600 秒は除外）
    expect(result.totalAttendanceSeconds).toBe(2400);
    expect(result.participants).toEqual([
      { name: "conferenceRecords/cr-1/participants/host", sessionCount: 1, totalSeconds: 3600 },
      { name: "conferenceRecords/cr-1/participants/u1", sessionCount: 2, totalSeconds: 1800 },
      { name: "conferenceRecords/cr-1/participants/u2", sessionCount: 1, totalSeconds: 600 },
    ]);
  });
});

describe("aggregateTranscriptEntries", () => {
  it("話者ごとにエントリ数・文字数・発言時間のみを集計し、本文文字列は出力に含めない", () => {
    const result = aggregateTranscriptEntries([
      {
        name: "conferenceRecords/cr-1/transcripts/t1/entries/1",
        participant: "conferenceRecords/cr-1/participants/u1",
        text: "こんにちは",
        startTime: "2026-11-19T10:01:00.000Z",
        endTime: "2026-11-19T10:01:12.000Z",
      },
      {
        name: "conferenceRecords/cr-1/transcripts/t1/entries/2",
        participant: "conferenceRecords/cr-1/participants/u1",
        text: "テスト",
        startTime: "2026-11-19T10:02:00.000Z",
        endTime: "2026-11-19T10:02:08.000Z",
      },
      {
        name: "conferenceRecords/cr-1/transcripts/t1/entries/3",
        participant: "conferenceRecords/cr-1/participants/u2",
        text: "了解",
        startTime: "2026-11-19T10:03:00.000Z",
        endTime: "2026-11-19T10:03:05.000Z",
      },
    ]);

    expect(result).toEqual([
      {
        participant: "conferenceRecords/cr-1/participants/u1",
        entryCount: 2,
        charCount: 8,
        speakingSeconds: 20,
      },
      {
        participant: "conferenceRecords/cr-1/participants/u2",
        entryCount: 1,
        charCount: 2,
        speakingSeconds: 5,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("こんにちは");
  });
});
