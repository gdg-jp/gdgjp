import { describe, expect, it, vi } from "vitest";
import {
  PostDraftError,
  attachMedia,
  createDraft,
  deleteDraft,
  removeMedia,
  updateDraft,
} from "./post-draft.service.server";
import type { LinkPreview, PostDraftDependencies } from "./post.types";

type Row = Record<string, unknown>;

function postRow(over: Row = {}): Row {
  return {
    id: "post-1",
    chapter_id: 1,
    x_account_id: "acc-1",
    text: "hello world",
    scheduled_at: "2026-09-01T00:00:00.000Z",
    condition: "scheduled",
    status: "scheduled",
    created_by_user_id: "u1",
    published_x_post_id: null,
    published_at: null,
    failure_reason: null,
    link_preview_url: null,
    link_preview_title: null,
    link_preview_description: null,
    link_preview_image_url: null,
    created_at: "t0",
    updated_at: "t0",
    ...over,
  };
}

function mediaRow(over: Row = {}): Row {
  return {
    id: "m-1",
    post_id: "post-1",
    r2_key: "1/post-1/k1",
    content_type: "image/png",
    byte_size: 100,
    alt_text: "",
    sort_order: 0,
    created_at: "t0",
    ...over,
  };
}

function xAccountRow(over: Row = {}): Row {
  return {
    id: "acc-1",
    chapter_id: 1,
    x_user_id: "x1",
    username: "gdg",
    display_name: "GDG",
    profile_image_url: null,
    access_token_ciphertext: "c",
    refresh_token_ciphertext: null,
    access_token_expires_at: null,
    authorized_by_user_id: "u1",
    created_at: "t0",
    updated_at: "t0",
    revoked_at: null,
    ...over,
  };
}

function makeDb(seed: { posts?: Row[]; media?: Row[]; xAccounts?: Row[] } = {}) {
  const posts = new Map<string, Row>();
  for (const row of seed.posts ?? []) posts.set(row.id as string, { ...row });
  const media: Row[] = (seed.media ?? []).map((row) => ({ ...row }));
  const xAccounts: Row[] = (seed.xAccounts ?? []).map((row) => ({ ...row }));
  const tags: Row[] = [];
  const flags = { failInsertPostMedia: false };

  function run(sql: string, b: unknown[]) {
    if (sql.startsWith("INSERT INTO posts")) {
      const [
        id,
        chapterId,
        xAccountId,
        text,
        scheduledAt,
        condition,
        status,
        createdByUserId,
        previewUrl,
        previewTitle,
        previewDescription,
        previewImageUrl,
        createdAt,
        updatedAt,
      ] = b;
      posts.set(id as string, {
        id,
        chapter_id: chapterId,
        x_account_id: xAccountId,
        text,
        scheduled_at: scheduledAt,
        condition,
        status,
        created_by_user_id: createdByUserId,
        published_x_post_id: null,
        published_at: null,
        failure_reason: null,
        link_preview_url: previewUrl,
        link_preview_title: previewTitle,
        link_preview_description: previewDescription,
        link_preview_image_url: previewImageUrl,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE posts SET x_account_id")) {
      const [xAccountId, text, scheduledAt, condition, status, u, t, d, i, updatedAt, id] = b;
      const row = posts.get(id as string);
      if (row) {
        Object.assign(row, {
          x_account_id: xAccountId,
          text,
          scheduled_at: scheduledAt,
          condition,
          status,
          link_preview_url: u,
          link_preview_title: t,
          link_preview_description: d,
          link_preview_image_url: i,
          updated_at: updatedAt,
          failure_reason: null,
        });
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.startsWith("UPDATE posts SET status")) {
      const [status, updatedAt, id] = b;
      const row = posts.get(id as string);
      if (row && row.status !== "published" && row.status !== "posting") {
        Object.assign(row, { status, updated_at: updatedAt });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("DELETE FROM posts")) {
      const [id] = b;
      const row = posts.get(id as string);
      if (row && row.status !== "published" && row.status !== "posting") {
        posts.delete(id as string);
        let removed = 0;
        for (let n = media.length - 1; n >= 0; n--) {
          if (media[n].post_id === id) {
            media.splice(n, 1);
            removed++;
          }
        }
        return { meta: { changes: 1 + removed } };
      }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("INSERT INTO post_media ")) {
      if (flags.failInsertPostMedia) throw new Error("D1_ERROR: forced post_media insert failure");
      const [id, postId, r2Key, contentType, byteSize, altText, sortOrder, createdAt] = b;
      media.push({
        id,
        post_id: postId,
        r2_key: r2Key,
        content_type: contentType,
        byte_size: byteSize,
        alt_text: altText,
        sort_order: sortOrder,
        created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM post_media WHERE id")) {
      const [id] = b;
      for (let n = media.length - 1; n >= 0; n--) if (media[n].id === id) media.splice(n, 1);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE post_media SET alt_text")) {
      const [altText, sortOrder, id] = b;
      const row = media.find((m) => m.id === id);
      if (row) Object.assign(row, { alt_text: altText, sort_order: sortOrder });
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.startsWith("DELETE FROM post_media_tags")) {
      const [postId] = b;
      for (let n = tags.length - 1; n >= 0; n--) if (tags[n].post_id === postId) tags.splice(n, 1);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO post_media_tags")) {
      const [postId, xUserId, username] = b;
      tags.push({ post_id: postId, x_user_id: xUserId, username });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  function first(sql: string, b: unknown[]) {
    if (sql.includes("FROM posts WHERE id = ?")) return posts.get(b[0] as string) ?? null;
    if (sql.includes("FROM x_accounts WHERE id = ?"))
      return xAccounts.find((a) => a.id === b[0]) ?? null;
    if (sql.includes("FROM post_media WHERE id = ?"))
      return media.find((m) => m.id === b[0]) ?? null;
    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  function all(sql: string, b: unknown[]) {
    if (sql.includes("FROM post_media WHERE post_id IN")) {
      const results = media
        .filter((m) => b.includes(m.post_id))
        .sort((x, y) => (x.sort_order as number) - (y.sort_order as number));
      return { results };
    }
    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  function prepare(sql: string) {
    const stmt = {
      _bound: [] as unknown[],
      bind(...values: unknown[]) {
        stmt._bound = values;
        return stmt;
      },
      run: async () => run(sql, stmt._bound),
      first: async <T>() => first(sql, stmt._bound) as T,
      all: async <T>() => all(sql, stmt._bound) as { results: T[] },
    };
    return stmt;
  }

  const db = {
    prepare,
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };

  return { db: db as unknown as D1Database, posts, media, tags, xAccounts, flags };
}

function makeR2() {
  const store = new Map<string, unknown>();
  const puts: string[] = [];
  const deletes: string[] = [];
  const flags = { failDelete: false };
  const r2 = {
    put: vi.fn(async (key: string, bytes: unknown) => {
      store.set(key, bytes);
      puts.push(key);
    }),
    delete: vi.fn(async (key: string) => {
      if (flags.failDelete) throw new Error("R2 delete failed");
      deletes.push(key);
      store.delete(key);
    }),
    get: vi.fn(async (key: string) =>
      store.has(key) ? { arrayBuffer: async () => store.get(key) } : null,
    ),
  };
  return { r2: r2 as unknown as R2Bucket, store, puts, deletes, flags };
}

function makeDeps(
  db: D1Database,
  media: R2Bucket,
  over: Partial<PostDraftDependencies> = {},
): PostDraftDependencies {
  return {
    db,
    media,
    linkPreviewForText: vi.fn(async () => null),
    resolveTagHandle: vi.fn(async (_accountId: string, handle: string) => ({
      id: `uid-${handle.replace(/^@/, "")}`,
      username: handle.replace(/^@/, ""),
    })),
    ...over,
  };
}

const PREVIEW: LinkPreview = {
  url: "https://example.com/a",
  title: "Card title",
  description: "Card description",
  imageUrl: "https://example.com/a.png",
};

const baseInput = {
  chapterId: 1,
  xAccountId: "acc-1",
  text: "Check https://example.com/a for details",
  scheduledAt: "2026-09-01T00:00:00.000Z",
  condition: "scheduled" as const,
  createdByUserId: "u1",
};

describe("createDraft", () => {
  it("derives and persists a link preview from the injected provider", async () => {
    const { db, posts } = makeDb({ xAccounts: [xAccountRow()] });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2, { linkPreviewForText: vi.fn(async () => PREVIEW) });

    const post = await createDraft(deps, baseInput);

    expect(deps.linkPreviewForText).toHaveBeenCalledWith(baseInput.text);
    expect(post.linkPreviewTitle).toBe("Card title");
    expect(post.linkPreviewImageUrl).toBe("https://example.com/a.png");
    expect(posts.get(post.id)?.link_preview_url).toBe("https://example.com/a");
  });

  it("still saves the draft when the preview provider fails", async () => {
    const { db } = makeDb({ xAccounts: [xAccountRow()] });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2, {
      linkPreviewForText: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });

    const post = await createDraft(deps, baseInput);

    expect(post.linkPreviewUrl).toBeNull();
    expect(post.linkPreviewTitle).toBeNull();
    expect(post.linkPreviewDescription).toBeNull();
    expect(post.linkPreviewImageUrl).toBeNull();
  });

  it("rejects an X account owned by another chapter", async () => {
    const { db } = makeDb({ xAccounts: [xAccountRow({ id: "acc-2", chapter_id: 2 })] });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    await expect(createDraft(deps, { ...baseInput, xAccountId: "acc-2" })).rejects.toMatchObject({
      code: "account_not_found",
    });
  });

  it("rejects a revoked X account", async () => {
    const { db } = makeDb({ xAccounts: [xAccountRow({ revoked_at: "2026-01-01T00:00:00.000Z" })] });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    await expect(createDraft(deps, baseInput)).rejects.toMatchObject({ code: "account_not_found" });
  });

  it("normalizes and resolves tag handles through the selected account", async () => {
    const { db, tags } = makeDb({ xAccounts: [xAccountRow()] });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    const post = await createDraft(deps, { ...baseInput, tagHandles: ["@gdg_tokyo @gdg_osaka"] });

    expect(deps.resolveTagHandle).toHaveBeenCalledTimes(2);
    expect(tags.map((t) => t.username)).toEqual(["gdg_tokyo", "gdg_osaka"]);
    expect(tags.every((t) => t.post_id === post.id)).toBe(true);
  });
});

describe("updateDraft", () => {
  it("re-derives the preview only when the final text changes", async () => {
    const { db } = makeDb({
      posts: [postRow({ text: "original", link_preview_title: "OLD" })],
      xAccounts: [xAccountRow()],
    });
    const { r2 } = makeR2();
    const provider = vi.fn(async () => ({ ...PREVIEW, title: "NEW" }));
    const deps = makeDeps(db, r2, { linkPreviewForText: provider });

    const unchanged = await updateDraft(deps, "post-1", { text: "original" });
    expect(provider).not.toHaveBeenCalled();
    expect(unchanged.linkPreviewTitle).toBe("OLD");

    const changed = await updateDraft(deps, "post-1", { text: "a different body" });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(changed.linkPreviewTitle).toBe("NEW");
  });

  it("refuses to edit a post that is already posting", async () => {
    const { db } = makeDb({
      posts: [postRow({ status: "posting" })],
      xAccounts: [xAccountRow()],
    });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    await expect(updateDraft(deps, "post-1", { text: "new" })).rejects.toMatchObject({
      code: "not_editable",
    });
  });

  it("clears tags when passed an empty handle list", async () => {
    const { db, tags } = makeDb({ posts: [postRow()], xAccounts: [xAccountRow()] });
    tags.push({ post_id: "post-1", x_user_id: "old", username: "old" });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    await updateDraft(deps, "post-1", { tagHandles: [] });

    expect(tags).toHaveLength(0);
  });
});

describe("deleteDraft", () => {
  it("refuses to delete a published or posting post", async () => {
    const { db } = makeDb({ posts: [postRow({ status: "published" })] });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    await expect(deleteDraft(deps, "post-1")).resolves.toEqual({
      ok: false,
      error: "not_deletable",
    });
  });

  it("deletes a draft and clears its media from storage", async () => {
    const { db, posts } = makeDb({
      posts: [postRow()],
      media: [
        mediaRow({ id: "m-1", r2_key: "1/post-1/a" }),
        mediaRow({ id: "m-2", r2_key: "1/post-1/b", sort_order: 1 }),
      ],
    });
    const { r2, deletes } = makeR2();
    const deps = makeDeps(db, r2);

    await expect(deleteDraft(deps, "post-1")).resolves.toEqual({ ok: true });
    expect(posts.has("post-1")).toBe(false);
    expect(deletes.sort()).toEqual(["1/post-1/a", "1/post-1/b"]);
  });
});

describe("attachMedia / removeMedia status transitions", () => {
  it("moves a photo-required draft to scheduled on the first image and back on the last", async () => {
    const { db } = makeDb({
      posts: [postRow({ condition: "photo_required", status: "waiting_for_photo" })],
      xAccounts: [xAccountRow()],
    });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    const attached = await attachMedia(deps, "post-1", {
      bytes: new ArrayBuffer(64),
      contentType: "image/png",
      sortOrder: 0,
    });
    expect(attached.post.status).toBe("scheduled");

    const removed = await removeMedia(deps, attached.media.id);
    expect(removed.post.status).toBe("waiting_for_photo");
    expect(removed).toMatchObject({ id: attached.media.id, deleted: true });
  });
});

describe("attachMedia validation", () => {
  it("rejects a fifth image", async () => {
    const { db } = makeDb({
      posts: [postRow()],
      media: [0, 1, 2, 3].map((n) => mediaRow({ id: `m-${n}`, sort_order: n })),
      xAccounts: [xAccountRow()],
    });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    await expect(
      attachMedia(deps, "post-1", {
        bytes: new ArrayBuffer(64),
        contentType: "image/png",
        sortOrder: 4,
      }),
    ).rejects.toMatchObject({ code: "too_many_images" });
  });

  it("rejects an oversized image and a non-image file", async () => {
    const { db } = makeDb({ posts: [postRow()], xAccounts: [xAccountRow()] });
    const { r2 } = makeR2();
    const deps = makeDeps(db, r2);

    await expect(
      attachMedia(deps, "post-1", {
        bytes: new ArrayBuffer(5 * 1024 * 1024 + 1),
        contentType: "image/png",
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "image_too_large" });

    await expect(
      attachMedia(deps, "post-1", {
        bytes: new ArrayBuffer(16),
        contentType: "text/plain",
        sortOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "not_image" });
  });
});

describe("storage / database compensation", () => {
  it("removes the R2 object when the post_media insert fails", async () => {
    const state = makeDb({ posts: [postRow()], xAccounts: [xAccountRow()] });
    const store = makeR2();
    const deps = makeDeps(state.db, store.r2);
    state.flags.failInsertPostMedia = true;

    await expect(
      attachMedia(deps, "post-1", {
        bytes: new ArrayBuffer(64),
        contentType: "image/png",
        sortOrder: 0,
      }),
    ).rejects.toThrow(/post_media insert failure/);

    expect(store.puts).toHaveLength(1);
    expect(store.deletes).toEqual(store.puts);
    expect(state.media).toHaveLength(0);
  });

  it("surfaces an R2 cleanup failure after the row is already removed", async () => {
    const { db, media } = makeDb({ posts: [postRow()], media: [mediaRow()] });
    const { r2, flags } = makeR2();
    const deps = makeDeps(db, r2);
    flags.failDelete = true;

    await expect(removeMedia(deps, "m-1")).rejects.toMatchObject({
      code: "media_storage_cleanup_failed",
    });
    expect(media).toHaveLength(0);
  });
});

describe("PostDraftError", () => {
  it("carries a machine-readable code", () => {
    const error = new PostDraftError("not_found");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("not_found");
  });
});
