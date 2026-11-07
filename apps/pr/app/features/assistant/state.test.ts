import { describe, expect, it } from "vitest";
import { emptyBrief } from "~/features/briefs/brief";
import { briefGaps, phaseOf } from "./state";

describe("briefGaps", () => {
  it("names what a plan needs", () => {
    expect(briefGaps(null)).toEqual(["イベントの情報"]);
    const brief = emptyBrief("DevFest", null, null);
    expect(briefGaps(brief)).toEqual(["日時", "会場", "申込目標"]);
    brief.event.startAt = "2026-11-22T10:30:00+09:00";
    brief.event.format = "online";
    brief.goals.applications = 150;
    expect(briefGaps(brief)).toEqual([]);
  });
});

describe("phaseOf", () => {
  const base = { status: "active" as const, briefReady: true, planAdopted: true, endAt: null };
  const day = 86_400;
  it("follows the campaign from preparation to the retro", () => {
    expect(phaseOf({ ...base, briefReady: false, eventAt: 30 * day, now: 0 })).toBe("prepare");
    expect(phaseOf({ ...base, planAdopted: false, eventAt: 30 * day, now: 0 })).toBe("plan");
    expect(phaseOf({ ...base, eventAt: 30 * day, now: 0 })).toBe("promote");
    expect(phaseOf({ ...base, eventAt: 30 * day, now: 30 * day + 3600 })).toBe("event");
    expect(phaseOf({ ...base, eventAt: 30 * day, now: 32 * day })).toBe("retro");
    expect(phaseOf({ ...base, status: "closed", eventAt: null, now: 0 })).toBe("retro");
  });
});
