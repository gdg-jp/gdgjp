import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHANNELS,
  extractChannelMappings,
  extractChannelQuestions,
} from "./connpass-channel-extraction";

describe("connpass channel extraction", () => {
  it("finds acquisition questions with deterministic patterns", () => {
    expect(
      extractChannelQuestions([
        "GDG は運営スタッフを募集中です。興味はありますか？",
        "どこからこのイベントを知りましたか？",
        "懇親会に参加しますか？",
      ]),
    ).toEqual(["どこからこのイベントを知りましたか？"]);
  });

  it("maps multi-select answers to every matching canonical channel", () => {
    expect(
      extractChannelMappings(["X, Instagram, Discord, connpass, 知人から"], [...DEFAULT_CHANNELS]),
    ).toEqual([
      {
        answer: "X, Instagram, Discord, connpass, 知人から",
        channelIds: ["X", "Instagram", "Discord", "connpass", "知人から"],
      },
    ]);
  });

  it("returns opaque Campaign channel IDs instead of inventing channel names", () => {
    expect(
      extractChannelMappings(
        ["X, Discord"],
        [
          { id: "11", label: "X", aliases: ["x"] },
          { id: "12", label: "Discord", aliases: ["discord"] },
        ],
      ),
    ).toEqual([{ answer: "X, Discord", channelIds: ["11", "12"] }]);
  });
});
