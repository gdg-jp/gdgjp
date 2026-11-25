import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  attachMedia,
  createDraft,
  saveScheduledDraft,
  updateDraft,
} from "./post-draft.service.server";
import type { PostDraftDependencies } from "./post.types";

const migrations = new URL("../../../migrations/", import.meta.url);

function migratedDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(fileURLToPath(migrations)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => ({
      success: true,
      meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) },
    }),
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: ReturnType<typeof statement>[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  sqlite.exec(`
    INSERT INTO x_accounts (id, chapter_id, x_user_id, username, display_name, access_token_ciphertext,
      authorized_by_user_id, created_at, updated_at)
    VALUES ('acc-1', 1, 'x-1', 'gdg', 'GDG', 'fixture-not-encrypted', 'u1', 't0', 't0');
  `);
  const rows = (sql: string) =>
    sqlite
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  return { db: db as unknown as D1Database, sqlite, rows };
}

function deps(
  db: D1Database,
  resolveTagHandle: PostDraftDependencies["resolveTagHandle"],
): PostDraftDependencies {
  return {
    db,
    media: {
      put: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
    } as unknown as R2Bucket,
    linkPreviewForText: vi.fn(async () => null),
    resolveTagHandle,
  };
}

const lookupFails = vi.fn(async (_accountId: string, _handle: string) => null);

const lookupUnavailable = vi.fn(async (_accountId: string, _handle: string) => {
  throw new Error("X user lookup failed with 429");
});

const lookupSucceeds = vi.fn(async (_accountId: string, handle: string) => {
  const username = handle.replace(/^@/, "").toLowerCase();
  return { id: `uid-${username}`, username };
});

const draft = {
  chapterId: 1,
  xAccountId: "acc-1",
  text: "Tagged photo post",
  scheduledAt: "2099-12-31T03:00:00.000Z",
  condition: "scheduled" as const,
  createdByUserId: "u1",
};

describe("tag handle lookup and the saved post", () => {
  it("leaves no post behind when a tag handle lookup fails on create", async () => {
    const { db, rows } = migratedDatabase();

    await expect(
      createDraft(deps(db, lookupFails), { ...draft, tagHandles: ["@missing_user"] }),
    ).rejects.toMatchObject({
      code: "tag_handle_not_found",
      message: "X user @missing_user was not found",
    });

    expect(rows("SELECT id, status FROM posts")).toEqual([]);
    expect(rows("SELECT post_id FROM post_media_tags")).toEqual([]);
  });

  it("reports an X outage as retryable, not as a wrong user name, and saves nothing", async () => {
    const { db, rows } = migratedDatabase();

    await expect(
      createDraft(deps(db, lookupUnavailable), { ...draft, tagHandles: ["@gdg_tokyo"] }),
    ).rejects.toMatchObject({ code: "tag_lookup_unavailable" });

    expect(rows("SELECT id FROM posts")).toEqual([]);
    expect(rows("SELECT post_id FROM post_media_tags")).toEqual([]);
  });

  it("leaves a failed post unchanged when a tag handle lookup fails on edit", async () => {
    const { db, sqlite, rows } = migratedDatabase();
    sqlite.exec(`
      INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status,
        created_by_user_id, failure_reason, created_at, updated_at)
      VALUES ('post-1', 1, 'acc-1', 'original text', '2026-01-01T03:00:00.000Z', 'scheduled',
        'failed', 'u1', 'X post failed (500)', 't0', 't0');
      INSERT INTO post_media_tags (post_id, x_user_id, username) VALUES ('post-1', 'uid-kept', 'kept');
    `);

    await expect(
      updateDraft(deps(db, lookupFails), "post-1", {
        text: "edited text",
        tagHandles: ["@missing_user"],
      }),
    ).rejects.toThrow("X user @missing_user was not found");

    expect(rows("SELECT text, status, failure_reason, updated_at FROM posts")).toEqual([
      {
        text: "original text",
        status: "failed",
        failure_reason: "X post failed (500)",
        updated_at: "t0",
      },
    ]);
    expect(rows("SELECT x_user_id FROM post_media_tags")).toEqual([{ x_user_id: "uid-kept" }]);
  });

  it("stores the post and its tags together, once per X user", async () => {
    const { db, rows } = migratedDatabase();

    const post = await createDraft(deps(db, lookupSucceeds), {
      ...draft,
      tagHandles: ["@gdg_tokyo, @GDG_Tokyo @gdg_osaka"],
    });

    expect(rows("SELECT id, status FROM posts")).toEqual([{ id: post.id, status: "scheduled" }]);
    expect(rows("SELECT post_id, x_user_id FROM post_media_tags ORDER BY x_user_id")).toEqual([
      { post_id: post.id, x_user_id: "uid-gdg_osaka" },
      { post_id: post.id, x_user_id: "uid-gdg_tokyo" },
    ]);
  });
});

describe("media sort order", () => {
  function postWithImage() {
    const state = migratedDatabase();
    state.sqlite.exec(`
      INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status,
        created_by_user_id, created_at, updated_at)
      VALUES ('post-1', 1, 'acc-1', 'Photo post', '2099-12-31T03:00:00.000Z', 'scheduled',
        'scheduled', 'u1', 't0', 't0');
      INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, sort_order, created_at)
      VALUES ('m-0', 'post-1', '1/post-1/first', 'image/png', 99, 0, 't0');
    `);
    return state;
  }

  it("refuses a position the post already uses without storing the image", async () => {
    const { db, rows } = postWithImage();
    const dependencies = deps(db, lookupSucceeds);

    await expect(
      attachMedia(dependencies, "post-1", {
        bytes: new ArrayBuffer(99),
        contentType: "image/png",
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "sort_order_taken" });

    expect(rows("SELECT id FROM post_media")).toEqual([{ id: "m-0" }]);
    expect(dependencies.media.put).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous uploads take a free position", async () => {
    const { db, rows } = postWithImage();
    const dependencies = deps(db, lookupSucceeds);
    const upload = () =>
      attachMedia(dependencies, "post-1", {
        bytes: new ArrayBuffer(99),
        contentType: "image/png",
        sortOrder: 1,
      });

    const results = await Promise.allSettled([upload(), upload()]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      code: "sort_order_taken",
    });
    expect(rows("SELECT sort_order FROM post_media ORDER BY sort_order")).toEqual([
      { sort_order: 0 },
      { sort_order: 1 },
    ]);
    expect(dependencies.media.put).toHaveBeenCalledTimes(2);
    expect(dependencies.media.delete).toHaveBeenCalledTimes(1);
  });

  it("refuses a position outside the four image slots", async () => {
    const { db, rows } = postWithImage();
    const dependencies = deps(db, lookupSucceeds);

    await expect(
      attachMedia(dependencies, "post-1", {
        bytes: new ArrayBuffer(99),
        contentType: "image/png",
        sortOrder: 4,
      }),
    ).rejects.toMatchObject({ code: "invalid_sort_order" });

    expect(rows("SELECT id FROM post_media")).toEqual([{ id: "m-0" }]);
    expect(dependencies.media.put).not.toHaveBeenCalled();
  });
});

describe("saving a post from the schedule screen", () => {
  it("closes the gap left by a removed image and puts a new one after the rest", async () => {
    const { db, sqlite, rows } = migratedDatabase();
    sqlite.exec(`
      INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status,
        created_by_user_id, created_at, updated_at)
      VALUES ('post-1', 1, 'acc-1', 'Photo post', '2099-12-31T03:00:00.000Z', 'scheduled',
        'scheduled', 'u1', 't0', 't0');
      INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, sort_order, created_at)
      VALUES ('m-0', 'post-1', 'k0', 'image/png', 9, 0, 't0'),
             ('m-1', 'post-1', 'k1', 'image/png', 9, 1, 't0'),
             ('m-2', 'post-1', 'k2', 'image/png', 9, 2, 't0'),
             ('m-3', 'post-1', 'k3', 'image/png', 9, 3, 't0');
    `);
    const dependencies = deps(db, lookupSucceeds);

    await saveScheduledDraft(dependencies, {
      ...draft,
      postId: "post-1",
      media: {
        keep: [
          { id: "m-3", altText: "d" },
          { id: "m-0", altText: "a" },
          { id: "m-2", altText: "c" },
        ],
        remove: ["m-1"],
        add: [{ bytes: new ArrayBuffer(9), contentType: "image/png", altText: "e" }],
      },
    });

    expect(rows("SELECT id, alt_text, sort_order FROM post_media ORDER BY sort_order")).toEqual([
      { id: "m-0", alt_text: "a", sort_order: 0 },
      { id: "m-2", alt_text: "c", sort_order: 1 },
      { id: "m-3", alt_text: "d", sort_order: 2 },
      expect.objectContaining({ alt_text: "e", sort_order: 3 }),
    ]);
    expect(dependencies.media.delete).toHaveBeenCalledWith("k1");
  });

  it("refuses media ids that do not belong to the post", async () => {
    const { db } = migratedDatabase();
    await expect(
      saveScheduledDraft(deps(db, lookupSucceeds), {
        ...draft,
        postId: null,
        media: { keep: [{ id: "someone-elses", altText: "" }], remove: [], add: [] },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("an edit racing the publisher", () => {
  it("refuses an edit whose post was claimed for posting after it was read", async () => {
    const { db, sqlite, rows } = migratedDatabase();
    sqlite.exec(`
      INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status,
        created_by_user_id, created_at, updated_at)
      VALUES ('post-1', 1, 'acc-1', 'original', '2099-12-31T03:00:00.000Z', 'scheduled',
        'scheduled', 'u1', 't0', 't0');
      INSERT INTO post_media_tags (post_id, x_user_id, username) VALUES ('post-1', 'uid-kept', 'kept');
    `);
    const claimWhileResolving = vi.fn(async (_accountId: string, handle: string) => {
      sqlite.exec("UPDATE posts SET status = 'posting' WHERE id = 'post-1'");
      return { id: `uid-${handle}`, username: handle };
    });

    await expect(
      updateDraft(deps(db, claimWhileResolving), "post-1", {
        text: "edited",
        tagHandles: ["@new"],
      }),
    ).rejects.toMatchObject({ code: "not_editable" });

    expect(rows("SELECT text, status FROM posts")).toEqual([
      { text: "original", status: "posting" },
    ]);
    expect(rows("SELECT x_user_id FROM post_media_tags")).toEqual([{ x_user_id: "uid-kept" }]);
  });
});
