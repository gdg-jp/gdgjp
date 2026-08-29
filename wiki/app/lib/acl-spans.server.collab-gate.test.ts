import { describe, expect, it, vi } from "vitest";
import { pageAclClearance } from "~/lib/acl-spans.server";

/**
 * `/ws/collab/:slug` short-circuits in workers/app.ts before the React Router
 * loader. This locks the clearance predicate that gate uses so a regression
 * cannot silently reopen the WebSocket path for redacted pages.
 */
describe("collab websocket ACL clearance gate", () => {
  it("denies clearance when the caller cannot read every span", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            all: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as never;

    const markdown = 'public <acl src="missing-source">secret</acl>';
    const member = {
      id: "member-1",
      email: "member@example.com",
      name: "Member",
      image: null,
      isAdmin: false,
    };

    await expect(pageAclClearance(db, [markdown], member, [])).resolves.toBe(false);
    await expect(pageAclClearance(db, [markdown], { ...member, isAdmin: true }, [])).resolves.toBe(
      true,
    );
  });

  it("requires AND across multi-source spans", async () => {
    const rows = [
      {
        id: "tokyo",
        addedBy: "owner",
        chapterId: "tokyo",
        visibility: "chapter-member",
        status: "ready",
      },
      {
        id: "osaka",
        addedBy: "owner",
        chapterId: "osaka",
        visibility: "chapter-member",
        status: "ready",
      },
    ];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            all: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    } as never;

    const markdown = '<acl src="tokyo osaka">both</acl>';
    const tokyoOnly = {
      id: "u1",
      email: "t@example.com",
      name: "T",
      image: null,
      isAdmin: false,
    };
    await expect(
      pageAclClearance(db, [markdown], tokyoOnly, [{ chapterId: "tokyo", role: "member" }]),
    ).resolves.toBe(false);
    await expect(
      pageAclClearance(db, [markdown], tokyoOnly, [
        { chapterId: "tokyo", role: "member" },
        { chapterId: "osaka", role: "member" },
      ]),
    ).resolves.toBe(true);
  });
});
