import { describe, expect, it } from "vitest";
import { campaignAcquisitionAnalytics } from "./campaign-acquisition";
import type { CampaignParticipantAnalyticsSnapshot } from "./campaign-participant-analytics-db";

const snapshot: CampaignParticipantAnalyticsSnapshot = {
  campaignId: 1,
  connpassEventId: "123",
  importedByUserId: "user",
  selectedQuestions: [],
  channelMappings: [],
  createdAt: 0,
  updatedAt: 0,
  participants: [
    {
      participantId: "one",
      participationType: "General",
      participationStatus: "参加",
      attendanceStatus: "出席",
      registeredAt: "2026-04-01T00:00:00.000Z",
      lastUpdatedAt: null,
      channelIds: [1, 2],
    },
    {
      participantId: "two",
      participationType: "General",
      participationStatus: "参加キャンセル",
      attendanceStatus: "",
      registeredAt: "2026-04-02T00:00:00.000Z",
      lastUpdatedAt: null,
      channelIds: [1],
    },
    {
      participantId: "three",
      participationType: "General",
      participationStatus: "参加",
      attendanceStatus: "欠席",
      registeredAt: null,
      lastUpdatedAt: "2026-04-03T00:00:00.000Z",
      channelIds: [],
    },
  ],
};

describe("campaignAcquisitionAnalytics", () => {
  it("counts multi-select channels, unanswered participants, cancellations, and attendance", () => {
    const result = campaignAcquisitionAnalytics({
      snapshot,
      channels: [
        { id: 1, name: "X" },
        { id: 2, name: "Discord" },
      ],
      window: { kind: "all" },
    });

    expect(result.summary).toEqual({
      applications: 3,
      cancellations: 1,
      attendanceRate: 50,
      participationTypes: [{ name: "General", count: 3 }],
    });
    expect(result.channels).toEqual([
      { key: "channel:Discord", name: "Discord", count: 1 },
      { key: "channel:Unanswered", name: "Unanswered", count: 1 },
      { key: "channel:X", name: "X", count: 1 },
    ]);
    expect(result.points).toHaveLength(1);
  });

  it("uses the CSV update time fallback and limits all summaries to the selected range", () => {
    const result = campaignAcquisitionAnalytics({
      snapshot,
      channels: [
        { id: 1, name: "X" },
        { id: 2, name: "Discord" },
      ],
      window: { kind: "custom", startIso: "2026-04-03", endIso: "2026-04-03" },
    });

    expect(result.summary).toEqual({
      applications: 1,
      cancellations: 0,
      attendanceRate: 0,
      participationTypes: [{ name: "General", count: 1 }],
    });
    expect(result.channels).toEqual([{ key: "channel:Unanswered", name: "Unanswered", count: 1 }]);
  });

  it("uses a requested interval for acquisition trend buckets", () => {
    const result = campaignAcquisitionAnalytics({
      snapshot,
      channels: [
        { id: 1, name: "X" },
        { id: 2, name: "Discord" },
      ],
      window: { kind: "all" },
      bucket: { amount: 2, unit: "hour" },
    });

    expect(result.granularity).toBe("hour");
    expect(result.bucketLabel).toBe("2 hours");
  });
});
