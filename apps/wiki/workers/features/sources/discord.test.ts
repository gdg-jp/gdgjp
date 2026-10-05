import { describe, expect, it } from "vitest";
import type { DiscordMessage } from "../../../app/features/discord/api.server";
import { extractUrlsFromDiscordMessage, normalizeDiscordMessages } from "./discord";

function message(
  partial: Partial<DiscordMessage> & Pick<DiscordMessage, "id" | "timestamp" | "content">,
): DiscordMessage {
  return {
    channel_id: "channel-1",
    author: { id: "user-1", username: "alice", global_name: "Alice" },
    attachments: [],
    ...partial,
  };
}

describe("normalizeDiscordMessages", () => {
  it("splits messages across week boundaries and keeps chronological order", () => {
    const weeks = normalizeDiscordMessages([
      message({
        id: "2",
        timestamp: "2026-08-10T03:00:00.000Z",
        content: "Later week",
      }),
      message({
        id: "1",
        timestamp: "2026-08-03T03:00:00.000Z",
        content: "Earlier week https://example.com/a",
      }),
    ]);

    expect(weeks.map((week) => week.path)).toEqual(["2026-08-03", "2026-08-10"]);
    expect(weeks[0]?.markdown).toContain("Earlier week");
    expect(weeks[0]?.markdown).toContain("## [");
    expect(weeks[0]?.markdown).toContain("Alice");
    expect(weeks[0]?.urls).toEqual(["https://example.com/a"]);
    expect(weeks[0]?.cursor).toBe("1");
    expect(weeks[1]?.cursor).toBe("2");
  });

  it("emits attachment placeholders and skips empty bodies", () => {
    const weeks = normalizeDiscordMessages([
      message({
        id: "10",
        timestamp: "2026-08-11T01:00:00.000Z",
        content: "",
        attachments: [
          {
            id: "att-1",
            filename: "photo.png",
            url: "https://cdn.discordapp.com/attachments/1/photo.png",
            content_type: "image/png",
            size: 123,
          },
        ],
      }),
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.markdown).toContain("![photo.png](attachment:att-1)");
    expect(weeks[0]?.attachments).toEqual([
      expect.objectContaining({ objectId: "att-1", contentName: "photo.png" }),
    ]);
  });

  it("uses the latest snowflake as the week cursor", () => {
    const weeks = normalizeDiscordMessages([
      message({
        id: "100",
        timestamp: "2026-08-11T01:00:00.000Z",
        content: "first",
      }),
      message({
        id: "200",
        timestamp: "2026-08-11T02:00:00.000Z",
        content: "second",
      }),
    ]);
    expect(weeks[0]?.cursor).toBe("200");
  });
});

describe("extractUrlsFromDiscordMessage", () => {
  it("collects content and embed urls", () => {
    expect(
      extractUrlsFromDiscordMessage(
        message({
          id: "1",
          timestamp: "2026-08-11T01:00:00.000Z",
          content: "See https://example.com/path).",
          embeds: [{ url: "https://example.com/embed" }],
        }),
      ),
    ).toEqual(["https://example.com/path", "https://example.com/embed"]);
  });
});
