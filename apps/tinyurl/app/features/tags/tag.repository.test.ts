import { beforeEach, describe, expect, it } from "vitest";
import {
  type TagActor,
  createTag,
  deleteTag,
  listTagsForActorPage,
  updateTag,
} from "~/features/tags/tag.repository";
import { type TestD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";

const owner: TagActor = { userId: "owner", chapterIds: [101], isSuperAdmin: false };
const peer: TagActor = { userId: "peer", chapterIds: [101], isSuperAdmin: false };
const outsider: TagActor = { userId: "outsider", chapterIds: [202], isSuperAdmin: false };
const admin: TagActor = { userId: "admin", chapterIds: [], isSuperAdmin: true };

let store: TestD1;
let personalTagId: number;
let chapterTagId: number;

function tagRow(id: number) {
  return store.raw
    .prepare("SELECT name, color, owner_user_id, owner_chapter_id FROM tags WHERE id = ?")
    .get(id);
}

async function seedTag(input: Parameters<typeof createTag>[1]): Promise<number> {
  const result = await createTag(store.db, input);
  if (!result.ok) throw new Error(`could not seed tag ${input.name}`);
  return result.tag.id;
}

beforeEach(async () => {
  store = createTestD1();
  personalTagId = await seedTag({ name: "owner-tag", color: "blue", ownerUserId: "owner" });
  chapterTagId = await seedTag({ name: "chapter-tag", color: "green", ownerChapterId: 101 });
});

describe("tag writes are scoped to tags the caller may manage", () => {
  it("refuses another chapter's member deleting a personal or chapter tag and keeps both rows", async () => {
    await expect(deleteTag(store.db, { id: personalTagId, actor: outsider })).resolves.toBe(false);
    await expect(deleteTag(store.db, { id: chapterTagId, actor: outsider })).resolves.toBe(false);
    expect(tagRow(personalTagId)).toMatchObject({ name: "owner-tag", owner_user_id: "owner" });
    expect(tagRow(chapterTagId)).toMatchObject({ name: "chapter-tag", owner_chapter_id: 101 });
  });

  it("refuses another chapter's member renaming a tag and leaves the name and color unchanged", async () => {
    await expect(
      updateTag(store.db, { id: personalTagId, name: "taken-over", color: "red", actor: outsider }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(
      updateTag(store.db, { id: chapterTagId, name: "taken-over", color: "red", actor: outsider }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(tagRow(personalTagId)).toMatchObject({ name: "owner-tag", color: "blue" });
    expect(tagRow(chapterTagId)).toMatchObject({ name: "chapter-tag", color: "green" });
  });

  it("refuses a member of the same chapter managing someone else's personal tag", async () => {
    await expect(deleteTag(store.db, { id: personalTagId, actor: peer })).resolves.toBe(false);
    await expect(
      updateTag(store.db, { id: personalTagId, name: "peer-rename", actor: peer }),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(tagRow(personalTagId)).toMatchObject({ name: "owner-tag" });
  });

  it("lets the owner rename and delete a personal tag", async () => {
    const renamed = await updateTag(store.db, {
      id: personalTagId,
      name: "owner-renamed",
      color: "red",
      actor: owner,
    });
    expect(renamed).toMatchObject({ ok: true, tag: { id: personalTagId, name: "owner-renamed" } });
    await expect(deleteTag(store.db, { id: personalTagId, actor: owner })).resolves.toBe(true);
    expect(tagRow(personalTagId)).toBeUndefined();
  });

  it("lets any member of the owning chapter rename and delete a chapter tag", async () => {
    await expect(
      updateTag(store.db, { id: chapterTagId, name: "chapter-renamed", actor: peer }),
    ).resolves.toMatchObject({ ok: true, tag: { name: "chapter-renamed" } });
    await expect(deleteTag(store.db, { id: chapterTagId, actor: peer })).resolves.toBe(true);
    expect(tagRow(chapterTagId)).toBeUndefined();
  });

  it("lets a super admin delete any tag", async () => {
    await expect(deleteTag(store.db, { id: personalTagId, actor: admin })).resolves.toBe(true);
    await expect(deleteTag(store.db, { id: chapterTagId, actor: admin })).resolves.toBe(true);
  });

  it("still reports a duplicate name on a tag the caller manages", async () => {
    await seedTag({ name: "second", ownerUserId: "owner" });
    await expect(
      updateTag(store.db, { id: personalTagId, name: "second", actor: owner }),
    ).resolves.toEqual({ ok: false, reason: "duplicate" });
  });

  it("lists exactly the tags each caller may manage", async () => {
    const names = async (actor: TagActor) =>
      (await listTagsForActorPage(store.db, { ...actor, limit: 10, offset: 0 })).tags.map(
        (tag) => tag.name,
      );
    await expect(names(owner)).resolves.toEqual(["chapter-tag", "owner-tag"]);
    await expect(names(peer)).resolves.toEqual(["chapter-tag"]);
    await expect(names(outsider)).resolves.toEqual([]);
    await expect(names(admin)).resolves.toEqual(["chapter-tag", "owner-tag"]);
  });
});
