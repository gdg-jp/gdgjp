import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { fakeImageBindings, folderRecord } from "./test-bindings";
import { uploadImage, uploadImageToFolderForActor } from "./upload.server";

const user = {
  id: "owner",
  email: "owner@example.com",
  name: "Owner",
  image: null,
} as AuthUser;

const input = {
  bytes: new TextEncoder().encode("<svg/>").buffer as ArrayBuffer,
  contentType: "image/svg+xml",
  filename: "logo.svg",
};

describe("uploadImage", () => {
  it("writes the R2 original before inserting the D1 row", async () => {
    const h = fakeImageBindings();
    const { id } = await uploadImage(h.env, h.ctx, { ...input, user, chapterId: 1 });
    expect(h.events).toEqual([`r2:put ${id}`, "d1:insert images"]);
  });

  it("removes the R2 original when the D1 insert fails", async () => {
    const h = fakeImageBindings({ failD1: (sql) => sql.startsWith("INSERT INTO images") });
    await expect(uploadImage(h.env, h.ctx, { ...input, user, chapterId: 1 })).rejects.toThrow(
      "D1 failed",
    );
    await h.flush();
    const [put, insert, cleanup] = h.events;
    expect(put).toMatch(/^r2:put /);
    expect(insert).toBe("d1:insert images");
    expect(cleanup).toBe(put.replace("r2:put", "r2:delete"));
  });

  it("stores the owner's user id as the account id of a new row", async () => {
    const h = fakeImageBindings();
    const { id } = await uploadImage(h.env, h.ctx, { ...input, user, chapterId: 1 });
    expect(h.image(id)).toMatchObject({ user_id: "owner", account_id: "owner" });
  });
});

describe("uploadImageToFolderForActor", () => {
  const actor = {
    user,
    chapters: [
      { chapterId: 1, chapterSlug: "primary", role: "member" as const },
      { chapterId: 2, chapterSlug: "other", role: "member" as const },
    ],
  };

  it("uploads into the folder's chapter, not the actor's first chapter, and files it", async () => {
    const h = fakeImageBindings({ folders: [folderRecord({ id: 42, chapter_id: 2 })] });
    const result = await uploadImageToFolderForActor(h.env, h.ctx, actor, input, 42);
    if (!result.ok) throw new Error(result.error);
    expect(h.image(result.value.id)).toMatchObject({ chapter_id: 2, folder_id: 42 });
    expect(h.r2Puts[0]?.customMetadata?.chapterId).toBe("2");
  });

  it("refuses a folder the actor cannot access without uploading anything", async () => {
    const h = fakeImageBindings({ folders: [folderRecord({ id: 7, chapter_id: 99 })] });
    expect(await uploadImageToFolderForActor(h.env, h.ctx, actor, input, 7)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await uploadImageToFolderForActor(h.env, h.ctx, actor, input, 8)).toEqual({
      ok: false,
      error: "folder_not_found",
    });
    expect(h.events).toEqual([]);
    expect(h.imageIds()).toEqual([]);
  });
});
