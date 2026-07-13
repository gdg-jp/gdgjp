import { describe, expect, it } from "vitest";
import type { CampaignParticipantAnalyticsSnapshot } from "~/lib/campaign-participant-analytics-db";
import { campaignConversionAttribution } from "./campaign-conversion-attribution";

function snapshot(): CampaignParticipantAnalyticsSnapshot {
  return {
    campaignId: 7,
    connpassEventId: "391029",
    importedByUserId: "user-1",
    selectedQuestions: [],
    channelMappings: [],
    participants: [
      {
        participantId: "1",
        participationType: "現地参加",
        registeredAt: "2026-07-10T12:30:00.000Z",
        lastUpdatedAt: "2026-07-10T12:30:00.000Z",
        channelIds: [11],
      },
      {
        participantId: "2",
        participationType: "現地参加",
        registeredAt: "2026-07-10T15:00:00.000Z",
        lastUpdatedAt: "2026-07-10T15:00:00.000Z",
        channelIds: [12],
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("campaignConversionAttribution", () => {
  it("fractionally attributes registrations from the preceding 24-hour Channel click mix", () => {
    const result = campaignConversionAttribution({
      snapshot: snapshot(),
      channels: [
        { id: 11, name: "X", links: [{ id: "x-link" }] },
        { id: 12, name: "Discord", links: [{ id: "discord-link" }] },
      ],
      clicks: [
        { hour: "2026-07-10T10:00:00.000Z", linkId: "x-link", source: "", clicks: 3 },
        { hour: "2026-07-10T10:00:00.000Z", linkId: "discord-link", source: "", clicks: 1 },
      ],
      window: { kind: "all" },
    });

    expect(result.registrations).toBe(2);
    expect(result.attributedRegistrations).toBe(2);
    expect(result.channels).toEqual([
      expect.objectContaining({ name: "X", estimatedRegistrations: 1.5, clicks: 3 }),
      expect.objectContaining({ name: "Discord", estimatedRegistrations: 0.5, clicks: 1 }),
    ]);
    expect(result.discoveryChannels).toEqual([
      { name: "Discord", count: 1 },
      { name: "X", count: 1 },
    ]);
  });

  it("leaves a registration unattributed when no click occurred in the preceding 24 hours", () => {
    const result = campaignConversionAttribution({
      snapshot: snapshot(),
      channels: [{ id: 11, name: "X", links: [{ id: "x-link" }] }],
      clicks: [{ hour: "2026-07-08T10:00:00.000Z", linkId: "x-link", source: "", clicks: 3 }],
      window: { kind: "all" },
    });
    expect(result.attributedRegistrations).toBe(0);
  });
});
