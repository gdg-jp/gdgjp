import { describe, expect, it } from "vitest";
import { chapterPrincipalKeys, resolveSpaceAccess } from "./access.server";
import { upsertSpaceMember } from "./members.server";
import { createChapterSpace, createPersonalSpace, createSharedSpace } from "./spaces.server";
import { createSpacesTestDb } from "./test-db";

const alice = { id: "alice", name: "Alice", isAdmin: false };
const bob = { id: "bob", name: "Bob", isAdmin: false };

describe("chapterPrincipalKeys", () => {
  it("expands organizer to member and adds wildcards", () => {
    expect(chapterPrincipalKeys([{ chapterId: "tokyo", role: "organizer" }]).sort()).toEqual(
      ["*:member", "*:organizer", "tokyo:member", "tokyo:organizer"].sort(),
    );
  });
  it("ignores unknown chapter roles", () => {
    expect(chapterPrincipalKeys([{ chapterId: "tokyo", role: "guest" }])).toEqual([]);
  });
});

describe("resolveSpaceAccess", () => {
  it("keeps v1's population for gdg-jp: anonymous viewer, any signed-in editor", async () => {
    const { db } = createSpacesTestDb();
    const anon = await resolveSpaceAccess(db, { user: null, chapters: [], claimsAvailable: true });
    expect(anon.get("gdg-jp")).toBe("viewer");
    const signedIn = await resolveSpaceAccess(db, {
      user: bob,
      chapters: [],
      claimsAvailable: true,
    });
    expect(signedIn.get("gdg-jp")).toBe("editor");
  });

  it("makes every space owner for admins", async () => {
    const { db } = createSpacesTestDb();
    await createPersonalSpace(db, alice);
    const access = await resolveSpaceAccess(db, {
      user: { id: "admin", isAdmin: true },
      chapters: [],
      claimsAvailable: true,
    });
    expect([...access.values()].every((role) => role === "owner")).toBe(true);
    expect(access.size).toBe(2);
  });

  it("hides a personal space from everyone but its owner", async () => {
    const { db } = createSpacesTestDb();
    const created = await createPersonalSpace(db, alice);
    if (!created.ok) throw new Error(created.error);
    const id = created.space.id;
    const own = await resolveSpaceAccess(db, { user: alice, chapters: [], claimsAvailable: true });
    const other = await resolveSpaceAccess(db, { user: bob, chapters: [], claimsAvailable: true });
    expect(own.get(id)).toBe("owner");
    expect(other.has(id)).toBe(false);
  });

  it("gives a chapter space to that chapter only: organizers own, members edit", async () => {
    const { db } = createSpacesTestDb();
    const created = await createChapterSpace(
      db,
      { user: alice, chapters: [{ chapterId: "tokyo", role: "organizer" }], claimsAvailable: true },
      { chapterId: "tokyo", name: "GDG Tokyo" },
    );
    if (!created.ok) throw new Error(created.error);
    const id = created.space.id;
    const member = await resolveSpaceAccess(db, {
      user: bob,
      chapters: [{ chapterId: "tokyo", role: "member" }],
      claimsAvailable: true,
    });
    const otherChapter = await resolveSpaceAccess(db, {
      user: bob,
      chapters: [{ chapterId: "osaka", role: "organizer" }],
      claimsAvailable: true,
    });
    const organizer = await resolveSpaceAccess(db, {
      user: alice,
      chapters: [{ chapterId: "tokyo", role: "organizer" }],
      claimsAvailable: true,
    });
    expect(member.get(id)).toBe("editor");
    expect(organizer.get(id)).toBe("owner");
    expect(otherChapter.has(id)).toBe(false);
  });

  it("does not evaluate chapter membership when claims are unavailable (fail closed)", async () => {
    const { db } = createSpacesTestDb();
    const created = await createChapterSpace(
      db,
      { user: alice, chapters: [{ chapterId: "tokyo", role: "organizer" }], claimsAvailable: true },
      { chapterId: "tokyo", name: "GDG Tokyo" },
    );
    if (!created.ok) throw new Error(created.error);
    const access = await resolveSpaceAccess(db, {
      user: bob,
      chapters: [{ chapterId: "tokyo", role: "member" }],
      claimsAvailable: false,
    });
    expect(access.has(created.space.id)).toBe(false);
  });

  it("takes the strongest role when several principals match", async () => {
    const { db } = createSpacesTestDb();
    const created = await createSharedSpace(db, alice, { slug: "team", name: "Team" });
    if (!created.ok) throw new Error(created.error);
    await upsertSpaceMember(db, created.space, {
      principalType: "chapter_role",
      principalId: "tokyo:member",
      role: "viewer",
    });
    await upsertSpaceMember(db, created.space, {
      principalType: "user",
      principalId: "bob",
      role: "editor",
    });
    const access = await resolveSpaceAccess(db, {
      user: bob,
      chapters: [{ chapterId: "tokyo", role: "member" }],
      claimsAvailable: true,
    });
    expect(access.get(created.space.id)).toBe("editor");
  });

  it("reaches a space through a Discord guild principal only when passed", async () => {
    const { db } = createSpacesTestDb();
    const created = await createSharedSpace(db, alice, { slug: "guild", name: "Guild" });
    if (!created.ok) throw new Error(created.error);
    await upsertSpaceMember(db, created.space, {
      principalType: "discord_guild",
      principalId: "123456789012345678",
      role: "viewer",
    });
    const without = await resolveSpaceAccess(db, {
      user: null,
      chapters: [],
      claimsAvailable: true,
    });
    const withGuild = await resolveSpaceAccess(
      db,
      { user: null, chapters: [], claimsAvailable: true },
      [{ type: "discord_guild", id: "123456789012345678" }],
    );
    expect(without.has(created.space.id)).toBe(false);
    expect(withGuild.get(created.space.id)).toBe("viewer");
  });
});
