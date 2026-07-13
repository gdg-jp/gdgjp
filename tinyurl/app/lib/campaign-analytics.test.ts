import { describe, expect, it } from "vitest";
import { campaignSourceBreakdown } from "./campaign-analytics";

describe("campaignSourceBreakdown", () => {
  it("keeps identical source codes scoped to their channels and resolves display names", () => {
    const result = campaignSourceBreakdown(
      [
        {
          id: 1,
          name: "X",
          links: [{ id: "x-link" }],
          sources: [{ code: "tokyo", name: "X Tokyo" }],
        },
        {
          id: 2,
          name: "Discord",
          links: [{ id: "d-link" }],
          sources: [{ code: "tokyo", name: "Discord Tokyo" }],
        },
      ],
      [
        { linkId: "x-link", source: "tokyo", clicks: 3 },
        { linkId: "d-link", source: "tokyo", clicks: 5 },
      ],
    );

    expect(result.rows).toEqual([
      { name: "Discord / Discord Tokyo (tokyo)", clicks: 5 },
      { name: "X / X Tokyo (tokyo)", clicks: 3 },
    ]);
    expect(result.unregistered).toEqual([]);
  });

  it("labels direct traffic and reports unregistered sources per channel", () => {
    const result = campaignSourceBreakdown(
      [{ id: 1, name: "X", links: [{ id: "x-link" }], sources: [] }],
      [
        { linkId: "x-link", source: "", clicks: 4 },
        { linkId: "x-link", source: "osaka", clicks: 2 },
      ],
    );

    expect(result.rows).toEqual([
      { name: "X / Direct / untagged", clicks: 4 },
      { name: "X / osaka (Unregistered)", clicks: 2 },
    ]);
    expect(result.unregistered).toEqual([
      { channelId: 1, channelName: "X", code: "osaka", clicks: 2 },
    ]);
  });
});
