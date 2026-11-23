import { describe, expect, it } from "vitest";
import {
  parseImageListCursor,
  setImageChapter,
  setImageFolder,
  setImageSlug,
  updateImageAttributes,
  updateImageBytes,
} from "./repository.server";
import { FAKE_NOW, fakeImageBindings, folderRecord, imageRecord } from "./test-bindings";

describe("parseImageListCursor", () => {
  it("parses a well-formed cursor", () => {
    expect(parseImageListCursor(JSON.stringify({ createdAt: 123, id: "abc" }))).toEqual({
      createdAt: 123,
      id: "abc",
    });
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseImageListCursor("not-json")).toBeUndefined();
  });

  it("returns undefined for well-formed JSON with the wrong shape", () => {
    expect(parseImageListCursor(JSON.stringify({ foo: "bar" }))).toBeUndefined();
    expect(
      parseImageListCursor(JSON.stringify({ createdAt: "not-a-number", id: "abc" })),
    ).toBeUndefined();
  });
});

describe("metadata-only image updates", () => {
  const original = imageRecord({ updated_at: 1 });

  it("keep updated_at, which keys the public ETag and derived renditions", async () => {
    const h = fakeImageBindings({ images: [original], folders: [folderRecord()] });
    const slug = await setImageSlug(h.env.DB, "img12345", "logo");
    const folder = await setImageFolder(h.env.DB, "img12345", 42);
    const chapter = await setImageChapter(h.env.DB, "img12345", 2);
    const attributes = await updateImageAttributes(h.env.DB, "img12345", {
      chapterId: 1,
      folderId: null,
      slug: "logo-2",
    });

    expect(slug.ok && slug.image.updatedAt).toBe(1);
    expect(folder.updatedAt).toBe(1);
    expect(chapter.updatedAt).toBe(1);
    expect(attributes.ok && attributes.image.updatedAt).toBe(1);
    expect(h.image("img12345")?.updated_at).toBe(1);
  });

  it("differ from a byte replacement, which does bump updated_at", async () => {
    const h = fakeImageBindings({ images: [original] });
    const updated = await updateImageBytes(h.env.DB, "img12345", {
      contentType: "image/png",
      byteSize: 1,
      width: null,
      height: null,
      filename: null,
    });
    expect(updated.updatedAt).toBe(FAKE_NOW);
  });
});
