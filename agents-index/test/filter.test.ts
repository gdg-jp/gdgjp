import { describe, expect, it } from "vitest";

import { canSearchChunk } from "../src/acl/filter.ts";

const chapterMember = { chapterId: "tokyo", role: "member" as const };

describe("canSearchChunk", () => {
  it("requires every intersecting ACL source", () => {
    const metadata = {
      subject: { visibility: "public", chapterId: null, access: [] },
      aclSourceIds: ["member", "organizer"],
    };
    const sources = new Map([
      ["member", { visibility: "member", chapterId: null }],
      ["organizer", { visibility: "organizer", chapterId: null }],
    ]);
    expect(
      canSearchChunk(metadata, sources, {
        classes: [chapterMember],
        channelAudience: { kind: "member" },
      }),
    ).toBe(false);
    expect(
      canSearchChunk(metadata, sources, {
        classes: [{ ...chapterMember, role: "organizer" }],
        channelAudience: { kind: "organizer" },
      }),
    ).toBe(true);
  });

  it("does not expose a chapter path through a nationwide member channel", () => {
    expect(
      canSearchChunk(
        { subject: { visibility: "chapter-member", chapterId: "tokyo" }, aclSourceIds: [] },
        new Map(),
        { classes: [chapterMember], channelAudience: { kind: "member" } },
      ),
    ).toBe(false);
    expect(
      canSearchChunk(
        { subject: { visibility: "chapter-member", chapterId: "tokyo" }, aclSourceIds: [] },
        new Map(),
        {
          classes: [chapterMember],
          channelAudience: { kind: "chapter-member", chapterId: "tokyo" },
        },
      ),
    ).toBe(true);
  });
});
