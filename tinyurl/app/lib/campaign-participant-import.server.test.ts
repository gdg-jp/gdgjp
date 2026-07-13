import { describe, expect, it } from "vitest";
import { buildCampaignParticipantAnalyticsInput } from "~/lib/campaign-participant-import.server";

const question = "どこからこのイベントを知りましたか？";

function draft() {
  return JSON.stringify({
    questions: [{ id: question, label: question }],
    selectedQuestionIds: [question],
    answerMappings: [
      {
        questionId: question,
        questionLabel: question,
        answer: "X",
        channelIds: ["11"],
      },
      {
        questionId: question,
        questionLabel: question,
        answer: "Discord",
        channelIds: ["12"],
      },
    ],
    source: {
      questionHeaders: [question],
      participants: [
        {
          participantId: "6844623",
          participationType: "現地参加",
          registeredAt: null,
          lastUpdatedAt: 1_772_850_120,
          responses: { [question]: "X, Discord" },
        },
      ],
    },
  });
}

function build(rawDraft = draft(), allowedChannelIds = [11, 12]) {
  return buildCampaignParticipantAnalyticsInput({
    rawDraft,
    campaignId: 7,
    connpassEventId: "391029",
    importedByUserId: "user-1",
    allowedChannelIds,
  });
}

describe("buildCampaignParticipantAnalyticsInput", () => {
  it("joins mappings to Campaign channel IDs and treats 更新日時 as registration time", () => {
    expect(build()).toMatchObject({
      campaignId: 7,
      connpassEventId: "391029",
      participants: [
        {
          registeredAt: new Date(1_772_850_120_000).toISOString(),
          lastUpdatedAt: new Date(1_772_850_120_000).toISOString(),
          channelIds: [11, 12],
        },
      ],
    });
  });

  it("excludes cancelled participants from registrations", () => {
    const parsed = JSON.parse(draft());
    parsed.source.participants[0].participationStatus = "参加キャンセル";
    parsed.answerMappings = [];
    expect(build(JSON.stringify(parsed)).participants).toEqual([]);
  });

  it("rejects a channel outside the current Campaign", () => {
    expect(() => build(draft(), [11])).toThrow("does not belong to this Campaign");
  });

  it("rejects a selected question that is not in the source CSV", () => {
    const parsed = JSON.parse(draft());
    parsed.source.questionHeaders = ["別の質問"];
    expect(() => build(JSON.stringify(parsed))).toThrow("does not exist in the source CSV");
  });

  it("rejects a mapping answer that is not in the source responses", () => {
    const parsed = JSON.parse(draft());
    parsed.answerMappings[0].answer = "Instagram";
    expect(() => build(JSON.stringify(parsed))).toThrow("does not exist in the source CSV");
  });

  it("requires exactly one mapping for every nonblank unique answer", () => {
    const parsed = JSON.parse(draft());
    parsed.source.participants.push({
      participantId: "6844624",
      participationType: "現地参加",
      registeredAt: null,
      lastUpdatedAt: null,
      responses: { [question]: "Instagram" },
    });
    expect(() => build(JSON.stringify(parsed))).toThrow("exactly one channel mapping");
  });

  it("requires one Campaign channel per split CSV option", () => {
    const parsed = JSON.parse(draft());
    parsed.answerMappings[0].channelIds = ["11", "12"];
    expect(() => build(JSON.stringify(parsed))).toThrow("exactly one channel");
  });
});
