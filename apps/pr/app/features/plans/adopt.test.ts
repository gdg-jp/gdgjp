import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planToItems } from "./adopt";
import type { PlanBody } from "./plan";

const example = JSON.parse(
  readFileSync(
    new URL("../../../../../skills/pr-plan/references/example-output.json", import.meta.url),
    "utf8",
  ),
) as PlanBody;

describe("planToItems", () => {
  it("attaches derived reminders to their parent and keeps blocking conditions", () => {
    const { roots, children, problems } = planToItems(example, 3, [
      { userId: "u-writer", name: "w", email: "w", roles: ["writer"], discordHandle: null },
    ]);
    expect(problems).toEqual([]);
    expect(roots.length + children.length).toBe(example.scheduleItems.length);
    const reminder = children.find((c) => c.input.kind === "staff_reminder");
    expect(reminder?.input.offsetMinutes).toBe(-60);
    expect(reminder?.input.requiresApproval).toBe(false);
    const post = roots.find((r) => r.input.kind === "x_post");
    expect(post?.input).toMatchObject({ planVersion: 3, assigneeUserId: "u-writer" });
  });

  it("marks tier: high speaker requests as suggestions", () => {
    const { children } = planToItems(example, 1, []);
    const high = children.find(
      (c) => c.input.kind === "speaker_request" && c.input.speakerId === "llion",
    );
    expect(high?.input.note).toMatch(/提案のみ/);
  });

  it("reports unknown kinds instead of dropping them silently", () => {
    const body = structuredClone(example);
    body.scheduleItems[0] = { ...body.scheduleItems[0], kind: "tiktok_dance" } as never;
    expect(planToItems(body, 1, []).problems[0]).toMatch(/未知の種類 tiktok_dance/);
  });
});
