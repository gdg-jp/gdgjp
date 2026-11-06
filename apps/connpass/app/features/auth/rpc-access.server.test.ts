import type { PrActor } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { groupForPrActor } from "./rpc-access.server";

const db = (chapterId: string | null) =>
  ({
    prepare: () => ({
      bind: () => ({
        first: async () => ({ groupSlug: "gdgkwansai", groupId: 1, chapterId, enabled: 1 }),
      }),
    }),
  }) as unknown as D1Database;
const actor = (role: "organizer" | "member", chapterId = 1): PrActor => ({
  user: { id: "u", email: "u@example.com", name: "u", image: null, isAdmin: false },
  chapters: [{ chapterId, chapterSlug: "c", role }],
});

describe("groupForPrActor", () => {
  it("lets the group's chapter read, and only its organizers write", async () => {
    expect(await groupForPrActor(db("1"), actor("member"), "gdgkwansai", false)).not.toBeNull();
    expect(await groupForPrActor(db("1"), actor("member"), "gdgkwansai", true)).toBeNull();
    expect(await groupForPrActor(db("1"), actor("organizer"), "gdgkwansai", true)).not.toBeNull();
  });
  it("refuses another chapter's group", async () => {
    expect(await groupForPrActor(db("2"), actor("organizer"), "gdgkwansai", false)).toBeNull();
  });
});
