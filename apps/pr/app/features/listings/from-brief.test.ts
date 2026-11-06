import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Brief } from "~/features/briefs/brief";
import { listingAsText, listingFromBrief } from "./from-brief";

const brief = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../skills/pr-playbook/examples/briefs/devfest-kansai-2026.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Brief;

describe("listingFromBrief", () => {
  it("maps the brief's facts and points to connpass", () => {
    const { listing } = listingFromBrief({
      platform: "luma",
      brief,
      organizer: "GDG Greater Kwansai",
      copyTitle: "DevFest Kansai 2026 — AI と越境",
      pageSummary: "1\n2\n3",
    });
    expect(listing).toMatchObject({
      mode: "pointer",
      title: "DevFest Kansai 2026 — AI と越境",
      summary: "1\n2\n3",
      startAt: brief.event.startAt,
      venue: { name: brief.event.venue },
      organizer: { name: "GDG Greater Kwansai" },
    });
    expect(listing.registrationUrl).toBe(brief.event.connpassUrl);
    expect(listing.description).not.toMatch(/<[a-z]/i);
  });
  it("lists the fields to paste by hand", () => {
    const fields = listingAsText(listingFromBrief({ platform: "findy", brief, organizer: "GDG" }));
    expect(fields.map((f) => f.label)).toEqual(
      expect.arrayContaining(["イベント名", "開始", "会場", "申込 URL"]),
    );
  });
});
