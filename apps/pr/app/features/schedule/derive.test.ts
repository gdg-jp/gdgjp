import { describe, expect, it } from "vitest";
import type { Brief } from "~/features/briefs/brief";
import { constants } from "~/features/playbook/playbook";
import { deriveItems } from "./derive";

const brief = {
  speakers: [
    { id: "saku", name: "saku", role: "", tier: "normal" },
    { id: "llion", name: "Llion Jones", role: "", tier: "high" },
  ],
} as unknown as Brief;
const due = Date.UTC(2026, 9, 6, 9) / 1000;

describe("deriveItems", () => {
  it("adds a staff reminder 60 minutes before every post", () => {
    for (const kind of ["x_post", "ig_post", "live_post"] as const) {
      const [reminder] = deriveItems({ kind, dueAt: due, title: "t" }, brief, constants);
      expect(reminder).toMatchObject({
        kind: "staff_reminder",
        dueAt: due - 3600,
        offsetMinutes: -60,
      });
    }
  });
  it("adds a speaker request 180 minutes before an X post with a speaker", () => {
    const derived = deriveItems(
      { kind: "x_post", dueAt: due, title: "t", speakerId: "saku" },
      brief,
      constants,
    );
    expect(derived.map((d) => d.kind)).toEqual(["staff_reminder", "speaker_request"]);
    expect(derived[1]).toMatchObject({ dueAt: due - 3 * 3600, purpose: "quote", note: null });
  });
  it("keeps a tier: high request as a suggestion that needs approval", () => {
    const [, request] = deriveItems(
      { kind: "x_post", dueAt: due, title: "t", speakerId: "llion" },
      brief,
      constants,
    );
    expect(request).toMatchObject({ requiresApproval: true });
    expect(request?.note).toMatch(/提案のみ/);
  });
  it("derives nothing for other kinds", () => {
    expect(deriveItems({ kind: "discord_post", dueAt: due, title: "t" }, brief, constants)).toEqual(
      [],
    );
  });
});
