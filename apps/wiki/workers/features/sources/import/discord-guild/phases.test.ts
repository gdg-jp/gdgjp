import { describe, expect, it } from "vitest";
import { selectGuildChannels } from "./phases";

const channels = [
  { id: "9000000000000100", name: "staff", type: 4 },
  { id: "9000000000000200", name: "general", type: 0, parent_id: null, position: 1 },
  { id: "9000000000000101", name: "plan", type: 0, parent_id: "9000000000000100", position: 2 },
  { id: "9000000000000102", name: "secret", type: 0, parent_id: "9000000000000100", position: 3 },
  { id: "9000000000000103", name: "voice", type: 2, parent_id: "9000000000000100", position: 4 },
];

describe("selectGuildChannels", () => {
  it("takes explicit channels and, with auto-discover, every text channel of a category", () => {
    const config = JSON.stringify({
      include: { categories: ["9000000000000100"], channels: ["9000000000000200"] },
      exclude: { channels: ["9000000000000102"] },
      autoDiscover: true,
    });
    expect(selectGuildChannels(channels, config)).toEqual([
      { id: "9000000000000200", name: "general", categoryName: null },
      { id: "9000000000000101", name: "plan", categoryName: "staff" },
    ]);
  });

  it("ignores categories without auto-discover", () => {
    const config = JSON.stringify({
      include: { categories: ["9000000000000100"], channels: ["9000000000000101"] },
      exclude: { channels: [] },
      autoDiscover: false,
    });
    expect(selectGuildChannels(channels, config).map((c) => c.id)).toEqual(["9000000000000101"]);
  });

  it("takes every text channel of the server, minus exclusions, for a whole-server config", () => {
    const config = JSON.stringify({
      all: true,
      include: { categories: [], channels: [] },
      exclude: { channels: ["9000000000000102"] },
    });
    expect(selectGuildChannels(channels, config).map((c) => c.id)).toEqual([
      "9000000000000200",
      "9000000000000101",
    ]);
  });

  it("selects nothing for a missing or invalid config", () => {
    expect(selectGuildChannels(channels, null)).toEqual([]);
    expect(selectGuildChannels(channels, "{}")).toEqual([]);
  });
});
