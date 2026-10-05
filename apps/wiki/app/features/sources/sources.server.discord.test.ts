import { describe, expect, it } from "vitest";
import { classifyDiscordChannel } from "~/features/sources/sources.server";

describe("classifyDiscordChannel", () => {
  it("accepts a picker channel with matching url and snowflake", () => {
    expect(
      classifyDiscordChannel(
        "123456789012345678",
        "#general",
        "https://discord.com/channels/111/123456789012345678",
      ),
    ).toEqual({
      ok: true,
      kind: "discord-channel",
      url: "https://discord.com/channels/111/123456789012345678",
      externalId: "123456789012345678",
      title: "#general",
    });
  });

  it("rejects mismatched channel ids", () => {
    expect(
      classifyDiscordChannel("123", "#general", "https://discord.com/channels/111/999"),
    ).toEqual({ ok: false, error: "invalid_channel" });
  });
});
