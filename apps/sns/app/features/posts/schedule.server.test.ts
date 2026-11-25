import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSchedule, submitSchedule } from "./schedule.server";

const lookup = vi.hoisted(() => ({
  resolve: vi.fn(async (_accountId: string, handle: string) => {
    const username = handle.replace(/^@/, "");
    return username === "missing" ? null : { id: `uid-${username}`, username };
  }),
}));

vi.mock("~/features/auth/access.server", () => ({
  requireSnsAccess: vi.fn(async () => ({
    user: { id: "u1", email: "org@example.com", name: "Org", image: null, isAdmin: false },
    chapter: { chapterId: 1, chapterSlug: "c1", role: "organizer" },
  })),
}));

vi.mock("./post-draft.deps.server", () => ({
  postDraftDepsFromEnv: (env: Env) => ({
    db: env.DB,
    media: env.MEDIA,
    linkPreviewForText: async () => null,
    resolveTagHandle: lookup.resolve,
  }),
}));

vi.mock("./scheduled-publishing.server", () => ({ claimAndPublish: vi.fn(async () => {}) }));

const migrations = new URL("../../../migrations/", import.meta.url);

function taggedPhotoPost() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(fileURLToPath(migrations)).sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  sqlite.exec(`
    INSERT INTO x_accounts (id, chapter_id, x_user_id, username, display_name, access_token_ciphertext,
      authorized_by_user_id, created_at, updated_at)
    VALUES ('acc-1', 1, 'x-1', 'gdg', 'GDG', 'fixture-not-encrypted', 'u1', 't0', 't0');
    INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status,
      created_by_user_id, created_at, updated_at)
    VALUES ('post-1', 1, 'acc-1', 'Photo post', '2099-12-31T03:00:00.000Z', 'scheduled',
      'scheduled', 'u1', 't0', 't0');
    INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order,
      created_at)
    VALUES ('m-0', 'post-1', '1/post-1/first', 'image/png', 99, 'first', 0, 't0'),
           ('m-1', 'post-1', '1/post-1/second', 'image/png', 99, 'second', 1, 't0');
    INSERT INTO post_media_tags (post_id, x_user_id, username)
    VALUES ('post-1', 'uid-gdg_tokyo', 'gdg_tokyo');
  `);
  const writes = { outsideBatch: [] as string[], batches: 0, failBatch: false };
  let inBatch = false;
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => {
      if (!inBatch && /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.outsideBatch.push(sql);
      return {
        success: true,
        meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) },
      };
    },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: ReturnType<typeof statement>[]) => {
      writes.batches++;
      if (writes.failBatch) throw new Error("D1 unavailable");
      inBatch = true;
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        inBatch = false;
      }
    },
  };
  const media = { put: vi.fn(async () => null), delete: vi.fn(async () => {}) };
  const env = { DB: db, MEDIA: media } as unknown as Env;
  const rows = (sql: string) =>
    sqlite
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  return { env, media, rows, writes };
}

function edit(env: Env, fields: Record<string, string | string[] | File>) {
  const form = new FormData();
  const base = {
    postId: "post-1",
    xAccountId: "acc-1",
    text: "Photo post, text edited",
    postingOption: "scheduled",
    scheduledAt: "2099-12-31T12:00",
    "alt-m-0": "first",
    "alt-m-1": "second",
  };
  for (const [name, value] of Object.entries({ ...base, ...fields }))
    for (const item of [value].flat()) form.append(name, item as string | Blob);
  return submitSchedule(
    new Request("https://sns.gdgs.jp/posts/schedule", { method: "POST", body: form }),
    env,
  ).catch((thrown: unknown) => thrown);
}

beforeEach(() => {
  lookup.resolve.mockClear();
});

describe("editing a scheduled post through the schedule screen", () => {
  it("shows the saved tags when the post is opened again", async () => {
    const { env } = taggedPhotoPost();
    const loaded = await loadSchedule(
      new Request("https://sns.gdgs.jp/posts/schedule?edit=post-1"),
      env,
    );
    expect(loaded.tagHandles).toBe("@gdg_tokyo");
  });

  it("keeps the saved tags, which the publish step reads, when only the text changes", async () => {
    const { env, rows } = taggedPhotoPost();

    const result = await edit(env, {});

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect(rows("SELECT text FROM posts")).toEqual([{ text: "Photo post, text edited" }]);
    expect(rows("SELECT x_user_id FROM post_media_tags WHERE post_id = 'post-1'")).toEqual([
      { x_user_id: "uid-gdg_tokyo" },
    ]);
    expect(lookup.resolve).not.toHaveBeenCalled();
  });

  it("keeps every image and its metadata when a new tag cannot be resolved", async () => {
    const { env, media, rows } = taggedPhotoPost();

    const result = await edit(env, {
      tagHandles: "@missing",
      deletedMedia: "m-0",
      "alt-m-1": "renamed",
    });

    expect(result).toMatchObject({ init: { status: 400 } });
    expect(rows("SELECT id, alt_text, sort_order FROM post_media ORDER BY sort_order")).toEqual([
      { id: "m-0", alt_text: "first", sort_order: 0 },
      { id: "m-1", alt_text: "second", sort_order: 1 },
    ]);
    expect(media.delete).not.toHaveBeenCalled();
    expect(rows("SELECT text FROM posts")).toEqual([{ text: "Photo post" }]);
    expect(rows("SELECT x_user_id FROM post_media_tags")).toEqual([{ x_user_id: "uid-gdg_tokyo" }]);
  });

  it("reports an X outage as retryable without touching the post", async () => {
    const { env, rows } = taggedPhotoPost();
    lookup.resolve.mockRejectedValueOnce(new Error("X user lookup failed with 503"));

    const result = await edit(env, { tagHandles: "@gdg_osaka", deletedMedia: "m-0" });

    expect(result).toMatchObject({ init: { status: 503 } });
    expect(rows("SELECT id FROM post_media ORDER BY sort_order")).toEqual([
      { id: "m-0" },
      { id: "m-1" },
    ]);
  });

  it("writes the text, the removed image and a new image in one batch", async () => {
    const { env, media, rows, writes } = taggedPhotoPost();

    const result = await edit(env, {
      postingOption: "immediate",
      deletedMedia: "m-0",
      images: new File([new Uint8Array(10)], "new.png", { type: "image/png" }),
      "new-alt-0": "new",
    });

    expect((result as Response).status).toBe(302);
    expect(writes).toMatchObject({ outsideBatch: [], batches: 1 });
    expect(rows("SELECT text FROM posts")).toEqual([{ text: "Photo post, text edited" }]);
    expect(rows("SELECT id, alt_text, sort_order FROM post_media ORDER BY sort_order")).toEqual([
      { id: "m-1", alt_text: "second", sort_order: 0 },
      expect.objectContaining({ alt_text: "new", sort_order: 1 }),
    ]);
    expect(media.put).toHaveBeenCalledTimes(1);
    expect(media.delete).toHaveBeenCalledWith("1/post-1/first");
  });

  it("changes nothing and removes the uploaded image when the write fails", async () => {
    const { env, media, rows, writes } = taggedPhotoPost();
    writes.failBatch = true;

    const result = await edit(env, {
      deletedMedia: "m-0",
      images: new File([new Uint8Array(10)], "new.png", { type: "image/png" }),
    });

    expect(result).toBeInstanceOf(Error);
    expect(rows("SELECT text FROM posts")).toEqual([{ text: "Photo post" }]);
    expect(rows("SELECT id FROM post_media ORDER BY sort_order")).toEqual([
      { id: "m-0" },
      { id: "m-1" },
    ]);
    const [[storedKey]] = media.put.mock.calls as unknown as [[string]];
    expect(media.delete.mock.calls).toEqual([[storedKey]]);
  });

  it("clears the saved tags when they are emptied, even with every image removed", async () => {
    const { env, rows } = taggedPhotoPost();

    const result = await edit(env, { tagHandles: "", deletedMedia: ["m-0", "m-1"] });

    expect((result as Response).status).toBe(302);
    expect(rows("SELECT x_user_id FROM post_media_tags")).toEqual([]);
    expect(rows("SELECT id FROM post_media")).toEqual([]);
  });
});
