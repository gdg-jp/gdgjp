import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { updateImageForActor } from "./service";

type Row = Record<string, unknown>;

function imageRow(overrides: Row = {}): Row {
  return {
    id: "img12345",
    user_id: "owner",
    account_id: "owner",
    chapter_id: 1,
    folder_id: null,
    slug: null,
    r2_key: "img12345",
    content_type: "image/png",
    byte_size: 100,
    width: null,
    height: null,
    filename: null,
    mobile_r2_key: null,
    mobile_content_type: null,
    mobile_byte_size: null,
    mobile_filename: null,
    mobile_updated_at: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function folderRow(overrides: Row = {}): Row {
  return {
    id: 42,
    chapter_id: 2,
    name: "logos",
    created_by_user_id: "owner",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

/**
 * Fake D1 covering only the statements updateImageForActor's dependencies
 * issue: getImage/getFolder (SELECT ... WHERE id = ?) and
 * updateImageAttributes (the single combined UPDATE). Tracks how many times
 * that UPDATE actually runs, so a rejected patch can be proven to have
 * written nothing at all — not even the fields that individually validated.
 */
function makeDb(image: Row | null, folder: Row | null = null) {
  let current = image ? { ...image } : null;
  let updateCalls = 0;

  function prepare(sql: string) {
    const stmt = {
      _bound: [] as unknown[],
      bind(...values: unknown[]) {
        stmt._bound = values;
        return stmt;
      },
      first: async <T>() => {
        if (sql.startsWith("SELECT") && sql.includes("FROM images WHERE id = ?")) {
          return (current && current.id === stmt._bound[0] ? current : null) as T | null;
        }
        if (sql.startsWith("SELECT") && sql.includes("FROM folders WHERE id = ?")) {
          return (folder && folder.id === stmt._bound[0] ? folder : null) as T | null;
        }
        if (sql.startsWith("UPDATE images SET chapter_id")) {
          updateCalls++;
          const [chapterId, folderId, slug, id] = stmt._bound;
          if (!current || current.id !== id) return null as T | null;
          current = { ...current, chapter_id: chapterId, folder_id: folderId, slug };
          return current as T;
        }
        throw new Error(`Unhandled first() SQL: ${sql}`);
      },
    };
    return stmt;
  }

  return {
    db: { prepare } as unknown as D1Database,
    updateCalls: () => updateCalls,
    snapshot: () => (current ? { ...current } : null),
  };
}

function env(db: D1Database) {
  return { DB: db } as unknown as Env;
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "owner",
    email: "owner@example.com",
    name: "Owner",
    image: null,
    isAdmin: false,
    ...overrides,
  };
}

function chapter(chapterId: number) {
  return { chapterId, chapterSlug: `chapter-${chapterId}`, role: "member" as const };
}

describe("updateImageForActor", () => {
  it("applies chapter, folder, and slug together in a single write", async () => {
    const { db, updateCalls } = makeDb(imageRow(), folderRow({ id: 42, chapter_id: 2 }));
    const actor = { user: user(), chapters: [chapter(1), chapter(2)] };

    const result = await updateImageForActor(env(db), actor, "img12345", {
      chapterId: 2,
      folderId: 42,
      slug: "my-pic",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chapterId).toBe(2);
      expect(result.value.folderId).toBe(42);
      expect(result.value.slug).toBe("my-pic");
    }
    expect(updateCalls()).toBe(1);
  });

  it("does not write anything when the patch matches the current state", async () => {
    const { db, updateCalls } = makeDb(imageRow({ chapter_id: 1, folder_id: null, slug: null }));
    const actor = { user: user(), chapters: [chapter(1)] };

    const result = await updateImageForActor(env(db), actor, "img12345", {
      chapterId: 1,
      slug: null,
    });

    expect(result.ok).toBe(true);
    expect(updateCalls()).toBe(0);
  });

  it("rejects an unknown folderId and leaves the valid chapter change uncommitted", async () => {
    const original = imageRow({ chapter_id: 1, folder_id: null });
    const { db, updateCalls, snapshot } = makeDb(original, null);
    const actor = { user: user(), chapters: [chapter(1), chapter(2)] };

    const result = await updateImageForActor(env(db), actor, "img12345", {
      chapterId: 2,
      folderId: 999,
    });

    expect(result).toEqual({ ok: false, error: "folder_not_found" });
    expect(updateCalls()).toBe(0);
    expect(snapshot()).toEqual(original);
  });

  it("rejects a folder from a different (but accessible) chapter and leaves the valid chapter change uncommitted", async () => {
    const original = imageRow({ chapter_id: 1, folder_id: null });
    // The actor can access the folder (they belong to chapter 5, where it
    // lives) — the rejection must come from the folder/target-chapter
    // mismatch, not from a plain access-denied on the folder itself.
    const { db, updateCalls, snapshot } = makeDb(original, folderRow({ id: 42, chapter_id: 5 }));
    const actor = { user: user(), chapters: [chapter(1), chapter(2), chapter(5)] };

    const result = await updateImageForActor(env(db), actor, "img12345", {
      chapterId: 2,
      folderId: 42,
    });

    expect(result).toEqual({ ok: false, error: "folder_chapter_mismatch" });
    expect(updateCalls()).toBe(0);
    expect(snapshot()).toEqual(original);
  });

  it("rejects an invalid slug and leaves the valid chapter/folder change uncommitted", async () => {
    const original = imageRow({ chapter_id: 1, folder_id: null });
    const { db, updateCalls, snapshot } = makeDb(original, folderRow({ id: 42, chapter_id: 2 }));
    const actor = { user: user(), chapters: [chapter(1), chapter(2)] };

    const result = await updateImageForActor(env(db), actor, "img12345", {
      chapterId: 2,
      folderId: 42,
      slug: "not a valid slug!!",
    });

    expect(result).toEqual({ ok: false, error: "invalid_slug" });
    expect(updateCalls()).toBe(0);
    expect(snapshot()).toEqual(original);
  });

  it("rejects a chapter the actor doesn't belong to and writes nothing", async () => {
    const original = imageRow({ chapter_id: 1 });
    const { db, updateCalls, snapshot } = makeDb(original);
    const actor = { user: user(), chapters: [chapter(1)] };

    const result = await updateImageForActor(env(db), actor, "img12345", { chapterId: 99 });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(updateCalls()).toBe(0);
    expect(snapshot()).toEqual(original);
  });

  it("allows a super admin to target a chapter they don't belong to", async () => {
    const { db, updateCalls } = makeDb(imageRow({ chapter_id: 1, folder_id: null }));
    const actor = { user: user({ isAdmin: true }), chapters: [chapter(1)] };

    const result = await updateImageForActor(env(db), actor, "img12345", { chapterId: 99 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chapterId).toBe(99);
    expect(updateCalls()).toBe(1);
  });
});
