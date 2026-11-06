import type { PrActor } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { canPostForChapter } from "./rpc-access.server";

const db = (contributor: boolean) =>
  ({
    prepare: () => ({ bind: () => ({ first: async () => (contributor ? { ok: 1 } : null) }) }),
  }) as unknown as D1Database;
const actor = (role: "organizer" | "member", chapterId = 1, isAdmin = false): PrActor => ({
  user: { id: "u", email: "u@example.com", name: "u", image: null, isAdmin },
  chapters: [{ chapterId, chapterSlug: "c", role }],
});

describe("canPostForChapter", () => {
  it("lets the chapter's organizers and contributors post", async () => {
    expect(await canPostForChapter(db(false), actor("organizer"), 1)).toBe(true);
    expect(await canPostForChapter(db(true), actor("member"), 1)).toBe(true);
  });
  it("refuses members of the chapter who are not contributors, and other chapters' organizers", async () => {
    expect(await canPostForChapter(db(false), actor("member"), 1)).toBe(false);
    expect(await canPostForChapter(db(false), actor("organizer", 2), 1)).toBe(false);
  });
});
