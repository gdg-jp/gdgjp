import { describe, expect, it } from "vitest";
import type { AgentWorkspaceContext } from "~/lib/agent-workspace.server";
import { computeAccessFloor, parseNoteBody } from "./agent-notes.server";

describe("parseNoteBody", () => {
  it("rejects unknown authority fields from the body", () => {
    const result = parseNoteBody({
      slug: "venue-picks",
      title: "Venue picks",
      summary: "Compare halls.",
      content: "A".repeat(200),
      citedPaths: ["/wiki/venues/a", "/wiki/venues/b"],
      visibility: "public",
      parentId: "ns-events",
      pageType: "event",
      chapterId: "evil",
    });
    expect(result).toEqual({ ok: false, error: "unknown_field", status: 400 });
  });

  it("accepts a minimal valid body", () => {
    const result = parseNoteBody({
      slug: "venue-picks",
      title: "Venue picks",
      summary: "Compare halls.",
      content: "A".repeat(200),
      citedPaths: ["/wiki/venues/a", "/wiki/venues/b"],
    });
    expect(result.ok).toBe(true);
  });
});

describe("computeAccessFloor", () => {
  const ctx = (chapterIds: string[]): AgentWorkspaceContext =>
    ({
      identity: {
        user: {
          id: "u1",
          email: "u@example.com",
          name: "U",
          image: null,
          isAdmin: false,
        },
        chapters: chapterIds.map((chapterId, i) => ({
          chapterId: i,
          chapterSlug: chapterId,
          role: "member",
        })),
      },
      workspace: {} as never,
      chapterIds,
    }) as AgentWorkspaceContext;

  it("refuses when cited pages span two chapters", async () => {
    const db = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              all: async () => [],
            }),
          }),
        }),
      }),
    } as never;

    const result = await computeAccessFloor(
      db,
      [
        { id: "p1", chapterId: "1" },
        { id: "p2", chapterId: "2" },
      ],
      ctx(["1", "2"]),
    );
    expect(result).toEqual({ ok: false, error: "citations_span_chapters", status: 409 });
  });

  it("refuses chapter-wide citations when the caller has multiple chapters", async () => {
    const db = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              all: async () => [],
            }),
          }),
        }),
      }),
    } as never;

    const result = await computeAccessFloor(
      db,
      [
        { id: "p1", chapterId: null },
        { id: "p2", chapterId: null },
      ],
      ctx(["1", "2"]),
    );
    expect(result).toEqual({ ok: false, error: "chapter_ambiguous", status: 409 });
  });

  it("refuses when any cited page has explicit page_access rows", async () => {
    const db = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              all: async () => [{ id: "acl-1" }],
            }),
          }),
        }),
      }),
    } as never;

    const result = await computeAccessFloor(
      db,
      [
        { id: "p1", chapterId: "1" },
        { id: "p2", chapterId: "1" },
      ],
      ctx(["1"]),
    );
    expect(result).toEqual({ ok: false, error: "citations_span_access", status: 409 });
  });
});
