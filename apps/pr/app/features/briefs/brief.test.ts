import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRIEF_REQUIRED, parseBrief } from "./brief";

const example = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../skills/pr-playbook/examples/briefs/devfest-kansai-2026.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

describe("parseBrief", () => {
  it("accepts the DevFest Kansai 2026 example", () => {
    expect(parseBrief(example)).toMatchObject({ ok: true });
  });
  it("requires exactly the schema's required keys", () => {
    // parseBrief validates with the Playbook schema itself, so the two cannot drift.
    expect([...BRIEF_REQUIRED].sort()).toEqual(
      ["audienceSegments", "budget", "event", "goals", "metaThemes", "sessions", "speakers"].sort(),
    );
    for (const key of BRIEF_REQUIRED) {
      const copy = structuredClone(example);
      delete copy[key];
      expect(parseBrief(copy).ok, key).toBe(false);
    }
  });
  it("rejects sessions that name unknown speakers", () => {
    const copy = structuredClone(example);
    copy.sessions[0].speakerIds = ["nobody"];
    const parsed = parseBrief(copy);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join()).toMatch(/nobody/);
  });
  it("drops empty optional values instead of failing on them", () => {
    const copy = structuredClone(example);
    copy.event.hashtag = "";
    copy.preEvents = [];
    const parsed = parseBrief(copy);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.brief.event.hashtag).toBeUndefined();
      expect(parsed.brief.preEvents).toEqual([]);
    }
  });
});
