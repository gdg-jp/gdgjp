import { describe, expect, it } from "vitest";
import { parseDiscordGuildConfig } from "./classify";
import { discordGuildSelectionConfig, hasDiscordGuildSelection } from "./discord-guild-selection";

const groups = [
  { categoryId: null, channels: [{ id: "9000000000000200" }] },
  {
    categoryId: "9000000000000100",
    channels: [{ id: "9000000000000101" }, { id: "9000000000000102" }],
  },
];

describe("discordGuildSelectionConfig", () => {
  it("stores the whole server as `all`, which parses back", () => {
    const selection = {
      wholeServer: true,
      autoDiscover: false,
      categoryIds: new Set<string>(),
      channelIds: new Set<string>(),
      groups,
    };
    const config = discordGuildSelectionConfig(selection);
    expect(config.all).toBe(true);
    expect(hasDiscordGuildSelection(selection)).toBe(true);
    expect(parseDiscordGuildConfig(JSON.stringify(config))).toEqual(config);
  });

  it("turns a category with an unchecked channel into include + exclude", () => {
    const selection = {
      wholeServer: false,
      autoDiscover: true,
      categoryIds: new Set(["9000000000000100"]),
      channelIds: new Set(["9000000000000101", "9000000000000200"]),
      groups,
    };
    expect(discordGuildSelectionConfig(selection)).toEqual({
      all: false,
      include: { categories: ["9000000000000100"], channels: ["9000000000000200"] },
      exclude: { channels: ["9000000000000102"] },
      autoDiscover: true,
    });
  });

  it("picks nothing without the whole server or a checked item", () => {
    expect(
      hasDiscordGuildSelection({
        wholeServer: false,
        autoDiscover: true,
        categoryIds: new Set(),
        channelIds: new Set(),
        groups,
      }),
    ).toBe(false);
  });
});
