import { describe, expect, it } from "vitest";
import { campaignSourceBreakdown, campaignTrendBreakdown } from "./campaign-analytics";

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
      { key: "source:2:tokyo", name: "Discord / Discord Tokyo (tokyo)", clicks: 5 },
      { key: "source:1:tokyo", name: "X / X Tokyo (tokyo)", clicks: 3 },
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
      { key: "source:1:", name: "X / Direct / untagged", clicks: 4 },
      { key: "source:1:osaka", name: "X / osaka (Unregistered)", clicks: 2 },
    ]);
    expect(result.unregistered).toEqual([
      { channelId: 1, channelName: "X", code: "osaka", clicks: 2 },
    ]);
  });
});

describe("campaignTrendBreakdown", () => {
  const channels = [
    {
      id: 1,
      name: "Social",
      links: [
        { id: "link-a", slug: "announce" },
        { id: "link-b", slug: "details" },
      ],
      sources: [{ code: "x", name: "X" }],
    },
    {
      id: 2,
      name: "Community",
      links: [{ id: "link-c", slug: "join" }],
      sources: [],
    },
  ];
  const rows = [
    { hour: "2026-07-01", linkId: "link-a", source: "x", clicks: 3 },
    { hour: "2026-07-01", linkId: "link-b", source: "", clicks: 2 },
    { hour: "2026-07-02", linkId: "link-c", source: "", clicks: 5 },
  ];

  it("aggregates link rows into channel series and fills missing buckets", () => {
    expect(campaignTrendBreakdown(channels, rows, "channel")).toEqual({
      series: [
        { key: "channel:1", label: "Social", clicks: 5 },
        { key: "channel:2", label: "Community", clicks: 5 },
      ],
      points: [
        { hour: "2026-07-01", "channel:1": 5, "channel:2": 0 },
        { hour: "2026-07-02", "channel:1": 0, "channel:2": 5 },
      ],
    });
  });

  it("can focus the trend on one clicked item", () => {
    expect(campaignTrendBreakdown(channels, rows, "link", "link:link-b")).toEqual({
      series: [{ key: "link:link-b", label: "details", clicks: 2 }],
      points: [{ hour: "2026-07-01", "link:link-b": 2 }],
    });
  });
});
