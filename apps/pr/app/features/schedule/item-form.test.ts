import { describe, expect, it } from "vitest";
import { NONE, parseItemForm } from "./item-form";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("parseItemForm", () => {
  it("reads a post with a speaker and a blocking condition", () => {
    const parsed = parseItemForm(
      form({
        kind: "x_post",
        dueAt: "2026-10-06T18:00",
        title: "セッション紹介",
        speakerId: "saku",
        sessionId: "s1",
        assignee: NONE,
        blockedBy: "session:s1:confirmed",
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      input: {
        kind: "x_post",
        dueAt: Date.UTC(2026, 9, 6, 9) / 1000,
        speakerId: "saku",
        assigneeUserId: null,
        blockedBy: ["session:s1:confirmed"],
      },
    });
  });
  it("rejects unknown kinds and missing times", () => {
    const parsed = parseItemForm(form({ kind: "tiktok", dueAt: "", title: "" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.errors).sort()).toEqual(["dueAt", "kind", "title"]);
  });
});
