import { describe, expect, it } from "vitest";
import { editDiscordMessage, replyDiscordMessage } from "./deliver";
import { mentionQuestion } from "./discord-message";

const BOT = "1535835155774709880";
const base = { id: "m1", channel_id: "c1", author: { id: "u1" } };

describe("mentionQuestion", () => {
  it("strips the bot's mention and keeps the question", () => {
    expect(
      mentionQuestion(
        { ...base, guild_id: "g1", content: `<@${BOT}> 会場は？`, mentions: [{ id: BOT }] },
        BOT,
      ),
    ).toBe("会場は？");
    expect(
      mentionQuestion(
        { ...base, guild_id: "g1", content: `会場は <@!${BOT}>`, mentions: [{ id: BOT }] },
        BOT,
      ),
    ).toBe("会場は");
  });

  it("ignores guild messages that do not mention the bot", () => {
    expect(
      mentionQuestion(
        { ...base, guild_id: "g1", content: "<@999> hi", mentions: [{ id: "999" }] },
        BOT,
      ),
    ).toBeNull();
  });

  it("answers DMs without a mention", () => {
    expect(mentionQuestion({ ...base, content: "会場は？" }, BOT)).toBe("会場は？");
  });

  it("never answers bots or webhooks, so two bots cannot loop", () => {
    const mention = { guild_id: "g1", content: `<@${BOT}> hi`, mentions: [{ id: BOT }] };
    expect(
      mentionQuestion({ ...base, ...mention, author: { id: "b", bot: true } }, BOT),
    ).toBeNull();
    expect(mentionQuestion({ ...base, ...mention, webhook_id: "w" }, BOT)).toBeNull();
  });

  it("returns an empty question for a bare mention (the caller replies with help)", () => {
    expect(
      mentionQuestion(
        { ...base, guild_id: "g1", content: `<@${BOT}>`, mentions: [{ id: BOT }] },
        BOT,
      ),
    ).toBe("");
  });
});

describe("Discord message delivery", () => {
  it("replies without pinging anyone but the asker, then edits that reply", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ id: "reply1" });
    }) as unknown as typeof fetch;

    const id = await replyDiscordMessage("c1", "m1", "考え中 @everyone", "tok", fetchImpl);
    await editDiscordMessage(
      { platform: "discord-message", channelId: "c1", messageId: id },
      { content: "答え" },
      "tok",
      fetchImpl,
    );

    expect(id).toBe("reply1");
    expect(calls[0].url).toBe("https://discord.com/api/v10/channels/c1/messages");
    const posted = JSON.parse(String(calls[0].init.body));
    expect(posted.message_reference.message_id).toBe("m1");
    expect(posted.allowed_mentions).toEqual({ parse: [], replied_user: true });
    expect(calls[1].url).toBe("https://discord.com/api/v10/channels/c1/messages/reply1");
    expect(calls[1].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[1].init.body)).allowed_mentions).toEqual({ parse: [] });
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bot tok");
  });
});
