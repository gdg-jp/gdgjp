import { describe, expect, it } from "vitest";
import {
  getCampaignParticipantAnalytics,
  replaceCampaignParticipantAnalytics,
} from "./campaign-participant-analytics-db";

describe("replaceCampaignParticipantAnalytics", () => {
  it("atomically replaces one Campaign snapshot using Campaign channel IDs", async () => {
    const prepared: { sql: string; bindings: unknown[] }[] = [];
    let batched: unknown[] = [];
    const db = {
      prepare(sql: string) {
        const statement = { sql, bindings: [] as unknown[] };
        prepared.push(statement);
        return {
          bind(...bindings: unknown[]) {
            statement.bindings = bindings;
            return this;
          },
        };
      },
      async batch(statements: unknown[]) {
        batched = statements;
        return [];
      },
    } as unknown as D1Database;

    await replaceCampaignParticipantAnalytics(db, {
      campaignId: 7,
      connpassEventId: "391029",
      importedByUserId: "user_owner",
      selectedQuestions: [{ id: "c7", label: "このイベントを知った場所" }],
      channelMappings: [
        {
          questionId: "c7",
          questionLabel: "このイベントを知った場所",
          answer: "X, Discord",
          channelIds: [11, 12, 11],
        },
      ],
      participants: [
        {
          participantId: "1234",
          participationType: "一般参加",
          registeredAt: null,
          lastUpdatedAt: "2025-04-09T01:30:00.000Z",
          channelIds: [11, 12, 11],
        },
      ],
    });

    expect(batched).toHaveLength(8);
    expect(prepared[0]?.sql).toContain("ON CONFLICT(campaign_id)");
    expect(prepared[0]?.bindings).toEqual([7, "391029", "user_owner"]);
    expect(prepared[1]?.sql).toContain("DELETE FROM campaign_participant_questions");
    expect(prepared[5]?.sql).toContain("DELETE FROM campaign_participants");
    expect(JSON.parse(String(prepared[4]?.bindings[1]))).toEqual([
      { questionId: "c7", answer: "X, Discord", channelId: 11 },
      { questionId: "c7", answer: "X, Discord", channelId: 12 },
    ]);
    expect(JSON.parse(String(prepared[7]?.bindings[1]))).toEqual([
      { participantId: "1234", channelId: 11 },
      { participantId: "1234", channelId: 12 },
    ]);
  });

  it("rejects duplicate participant IDs", async () => {
    const participant = {
      participantId: "1234",
      participationType: "一般参加",
      registeredAt: null,
      lastUpdatedAt: null,
      channelIds: [11],
    };
    await expect(
      replaceCampaignParticipantAnalytics({} as D1Database, {
        campaignId: 7,
        connpassEventId: "391029",
        importedByUserId: "owner",
        selectedQuestions: [],
        channelMappings: [],
        participants: [participant, participant],
      }),
    ).rejects.toThrow("Duplicate participant ID");
  });
});

describe("getCampaignParticipantAnalytics", () => {
  it("reconstructs mappings and participant channel unions", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            if (!sql.includes("campaign_participant_analytics")) return null;
            return {
              campaign_id: 7,
              connpass_event_id: "391029",
              imported_by_user_id: "owner",
              created_at: 100,
              updated_at: 200,
            };
          },
          async all() {
            if (sql.includes("SELECT question_id, question_label")) {
              return { results: [{ question_id: "c7", question_label: "Discovery" }] };
            }
            if (sql.includes("campaign_participant_channel_mappings")) {
              return {
                results: [
                  {
                    question_id: "c7",
                    question_label: "Discovery",
                    answer: "X, Discord",
                    channel_id: 11,
                  },
                  {
                    question_id: "c7",
                    question_label: "Discovery",
                    answer: "X, Discord",
                    channel_id: 12,
                  },
                ],
              };
            }
            return {
              results: [
                {
                  participant_id: "1234",
                  participation_type: "一般参加",
                  registered_at: null,
                  last_updated_at: "2025-04-09T01:30:00.000Z",
                  channel_id: 11,
                },
                {
                  participant_id: "1234",
                  participation_type: "一般参加",
                  registered_at: null,
                  last_updated_at: "2025-04-09T01:30:00.000Z",
                  channel_id: 12,
                },
              ],
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(getCampaignParticipantAnalytics(db, 7)).resolves.toEqual({
      campaignId: 7,
      connpassEventId: "391029",
      importedByUserId: "owner",
      selectedQuestions: [{ id: "c7", label: "Discovery" }],
      channelMappings: [
        {
          questionId: "c7",
          questionLabel: "Discovery",
          answer: "X, Discord",
          channelIds: [11, 12],
        },
      ],
      participants: [
        {
          participantId: "1234",
          participationType: "一般参加",
          registeredAt: null,
          lastUpdatedAt: "2025-04-09T01:30:00.000Z",
          channelIds: [11, 12],
        },
      ],
      createdAt: 100,
      updatedAt: 200,
    });
  });
});
