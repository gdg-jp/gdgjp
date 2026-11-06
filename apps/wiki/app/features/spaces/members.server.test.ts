import { describe, expect, it } from "vitest";
import { removeSpaceMember, upsertSpaceMember, validateMemberInput } from "./members.server";
import { createChapterSpace, createPersonalSpace, createSharedSpace } from "./spaces.server";
import { createSpacesTestDb } from "./test-db";

const alice = { id: "alice", name: "Alice", isAdmin: false };

describe("space membership by kind (Stage 01 §2-b)", () => {
  it("rejects every extra principal on a chapter space, even through the API", async () => {
    const { db } = createSpacesTestDb();
    const created = await createChapterSpace(
      db,
      { user: alice, chapters: [{ chapterId: "tokyo", role: "organizer" }], claimsAvailable: true },
      { chapterId: "tokyo", name: "GDG Tokyo" },
    );
    if (!created.ok) throw new Error(created.error);
    for (const principal of [
      { principalType: "user", principalId: "bob" },
      { principalType: "chapter_role", principalId: "osaka:member" },
      { principalType: "discord_guild", principalId: "123456789012345678" },
      { principalType: "chat_space", principalId: "spaces/AAAA" },
    ]) {
      await expect(
        upsertSpaceMember(db, created.space, { ...principal, role: "viewer" }),
      ).resolves.toMatchObject({ ok: false, error: "principal_not_allowed", status: 400 });
    }
  });

  it("rejects extra principals on a personal space", async () => {
    const { db } = createSpacesTestDb();
    const created = await createPersonalSpace(db, alice);
    if (!created.ok) throw new Error(created.error);
    await expect(
      upsertSpaceMember(db, created.space, {
        principalType: "user",
        principalId: "bob",
        role: "viewer",
      }),
    ).resolves.toMatchObject({ ok: false, error: "principal_not_allowed" });
  });

  it("allows one chapter space per chapter", async () => {
    const { db } = createSpacesTestDb();
    const identity = {
      user: alice,
      chapters: [{ chapterId: "tokyo", role: "organizer" }],
      claimsAvailable: true,
    };
    await createChapterSpace(db, identity, { chapterId: "tokyo", name: "GDG Tokyo" });
    await expect(
      createChapterSpace(db, identity, { chapterId: "tokyo", name: "GDG Tokyo" }),
    ).resolves.toMatchObject({ ok: false, status: 409 });
  });

  it("lets only organizers (or admins) create a chapter space", async () => {
    const { db } = createSpacesTestDb();
    await expect(
      createChapterSpace(
        db,
        { user: alice, chapters: [{ chapterId: "tokyo", role: "member" }], claimsAvailable: true },
        { chapterId: "tokyo", name: "GDG Tokyo" },
      ),
    ).resolves.toMatchObject({ ok: false, error: "forbidden_chapter", status: 403 });
  });

  it("refuses wildcards and the last owner's removal on shared spaces", async () => {
    const { db } = createSpacesTestDb();
    const created = await createSharedSpace(db, alice, { slug: "team", name: "Team" });
    if (!created.ok) throw new Error(created.error);
    expect(
      validateMemberInput("shared", { principalType: "user", principalId: "*", role: "viewer" }),
    ).toMatchObject({ ok: false });
    await expect(
      removeSpaceMember(db, created.space, { principalType: "user", principalId: "alice" }),
    ).resolves.toMatchObject({ ok: false, error: "last_owner" });
  });

  it("rejects reserved shared slugs", async () => {
    const { db } = createSpacesTestDb();
    for (const slug of ["gdg-jp", "u-alice", "c-tokyo", "A", "x"]) {
      await expect(createSharedSpace(db, alice, { slug, name: "n" })).resolves.toMatchObject({
        ok: false,
      });
    }
  });
});
