import { describe, expect, it } from "vitest";
import { type DiscordChannel, groupDiscordChannelsByCategory } from "~/lib/discord-api.server";

function channel(
  partial: Partial<DiscordChannel> & Pick<DiscordChannel, "id" | "name" | "type">,
): DiscordChannel {
  return {
    position: 0,
    parent_id: null,
    ...partial,
  };
}

describe("groupDiscordChannelsByCategory", () => {
  it("groups importable channels under categories and keeps Discord order", () => {
    const channels: DiscordChannel[] = [
      channel({ id: "cat-b", name: "Ops", type: 4, position: 20 }),
      channel({ id: "cat-a", name: "General", type: 4, position: 10 }),
      channel({ id: "ch-root", name: "announce", type: 5, position: 1 }),
      channel({ id: "ch-a2", name: "random", type: 0, position: 12, parent_id: "cat-a" }),
      channel({ id: "ch-a1", name: "chat", type: 0, position: 11, parent_id: "cat-a" }),
      channel({ id: "ch-b1", name: "alerts", type: 0, position: 21, parent_id: "cat-b" }),
      channel({ id: "voice", name: "Lounge", type: 2, position: 30, parent_id: "cat-b" }),
    ];

    expect(groupDiscordChannelsByCategory(channels)).toEqual([
      {
        categoryId: null,
        categoryName: null,
        channels: [{ id: "ch-root", name: "announce", type: 5, parentId: null }],
      },
      {
        categoryId: "cat-a",
        categoryName: "General",
        channels: [
          { id: "ch-a1", name: "chat", type: 0, parentId: "cat-a" },
          { id: "ch-a2", name: "random", type: 0, parentId: "cat-a" },
        ],
      },
      {
        categoryId: "cat-b",
        categoryName: "Ops",
        channels: [{ id: "ch-b1", name: "alerts", type: 0, parentId: "cat-b" }],
      },
    ]);
  });

  it("treats unknown parent ids as uncategorized and skips empty categories", () => {
    const channels: DiscordChannel[] = [
      channel({ id: "empty", name: "Empty", type: 4, position: 1 }),
      channel({ id: "orphan", name: "notes", type: 0, position: 2, parent_id: "missing" }),
    ];

    expect(groupDiscordChannelsByCategory(channels)).toEqual([
      {
        categoryId: null,
        categoryName: null,
        channels: [{ id: "orphan", name: "notes", type: 0, parentId: "missing" }],
      },
    ]);
  });
});
