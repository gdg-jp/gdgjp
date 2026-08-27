import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XPublishOutcome } from "./post-publishing.service.server";

const runXPublish = vi.fn<(env: Env, postId: string) => Promise<XPublishOutcome>>();
vi.mock("./post-publishing.service.server", () => ({
  runXPublish: (env: Env, postId: string) => runXPublish(env, postId),
}));

const { publishNow } = await import("./publish-now.service.server");

type Row = Record<string, unknown>;

function postRow(over: Row = {}): Row {
  return {
    id: "post-1",
    chapter_id: 1,
    x_account_id: "acc-1",
    text: "hello",
    // Deliberately in the future — `publishNow` must ignore `scheduledAt`.
    scheduled_at: "2999-01-01T00:00:00.000Z",
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

/** `posts`/`post_media` fake covering only the statements `publishNow` runs. */
function makeDb(seed: Row | null, mediaCount = 0) {
  const post = seed ? { ...seed } : null;
  let claimAttempted = false;
  const CLAIMABLE = new Set(["scheduled", "waiting_for_photo", "failed", "needs_confirmation"]);

  function prepare(sql: string) {
    const stmt = {
      _bound: [] as unknown[],
      bind(...values: unknown[]) {
        stmt._bound = values;
        return stmt;
      },
      first: async <T>() => {
        if (sql.startsWith("SELECT * FROM posts WHERE id = ?")) {
          return (post && post.id === stmt._bound[0] ? post : null) as T | null;
        }
        throw new Error(`Unhandled first SQL: ${sql}`);
      },
      all: async <T>() => {
        if (sql.includes("FROM post_media WHERE post_id IN")) {
          const rows = Array.from({ length: mediaCount }, (_, index) => ({
            id: `m${index}`,
            post_id: "post-1",
            r2_key: `k${index}`,
            content_type: "image/png",
            byte_size: 1,
            alt_text: "",
            sort_order: index,
            created_at: "t0",
          }));
          return { results: rows as T[] };
        }
        throw new Error(`Unhandled all SQL: ${sql}`);
      },
      run: async () => {
        if (sql.startsWith("UPDATE posts SET status = 'posting'")) {
          claimAttempted = true;
          const claimed = post !== null && CLAIMABLE.has(post.status as string);
          if (claimed) post.status = "posting";
          return { meta: { changes: claimed ? 1 : 0 } };
        }
        throw new Error(`Unhandled run SQL: ${sql}`);
      },
    };
    return stmt;
  }

  return {
    db: { prepare } as unknown as D1Database,
    wasClaimAttempted: () => claimAttempted,
    currentStatus: () => post?.status ?? null,
  };
}

const env = (db: D1Database) => ({ DB: db }) as unknown as Env;
const actor = { id: "u1" };

beforeEach(() => {
  runXPublish.mockReset();
  runXPublish.mockResolvedValue({ status: "published", post: {} as never });
});

describe("publishNow", () => {
  it("404s an unknown post before any claim", async () => {
    const { db, wasClaimAttempted } = makeDb(null);
    await expect(publishNow(env(db), "post-1", actor)).resolves.toEqual({ outcome: "not_found" });
    expect(wasClaimAttempted()).toBe(false);
    expect(runXPublish).not.toHaveBeenCalled();
  });

  it("refuses an already-published post with a conflict and never calls X", async () => {
    const { db, wasClaimAttempted } = makeDb(postRow({ status: "published" }));
    await expect(publishNow(env(db), "post-1", actor)).resolves.toEqual({
      outcome: "conflict",
      code: "already_published",
    });
    expect(wasClaimAttempted()).toBe(false);
    expect(runXPublish).not.toHaveBeenCalled();
  });

  it("refuses a post already posting with a conflict and never calls X", async () => {
    const { db } = makeDb(postRow({ status: "posting" }));
    await expect(publishNow(env(db), "post-1", actor)).resolves.toEqual({
      outcome: "conflict",
      code: "already_posting",
    });
    expect(runXPublish).not.toHaveBeenCalled();
  });

  it("refuses a photo_required post with no media and never claims", async () => {
    const { db, wasClaimAttempted } = makeDb(postRow({ condition: "photo_required" }), 0);
    await expect(publishNow(env(db), "post-1", actor)).resolves.toEqual({
      outcome: "conflict",
      code: "missing_required_media",
    });
    expect(wasClaimAttempted()).toBe(false);
    expect(runXPublish).not.toHaveBeenCalled();
  });

  it("claims a scheduled post despite a future scheduledAt and returns the published post", async () => {
    runXPublish.mockResolvedValue({
      status: "published",
      post: postRow({ status: "published" }) as never,
    });
    const { db, wasClaimAttempted } = makeDb(postRow({ status: "scheduled" }));
    const result = await publishNow(env(db), "post-1", actor);
    expect(wasClaimAttempted()).toBe(true);
    expect(runXPublish).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ outcome: "published" });
  });

  it("retries from failed", async () => {
    const { db } = makeDb(postRow({ status: "failed" }));
    await publishNow(env(db), "post-1", actor);
    expect(runXPublish).toHaveBeenCalledOnce();
  });

  it("retries from needs_confirmation (only ever via this explicit call)", async () => {
    const { db } = makeDb(postRow({ status: "needs_confirmation" }));
    await publishNow(env(db), "post-1", actor);
    expect(runXPublish).toHaveBeenCalledOnce();
  });

  it("passes an X-side failure back as x_failed carrying the persisted post", async () => {
    const failed = postRow({ status: "failed", failure_reason: "X post failed (500)" });
    runXPublish.mockResolvedValue({ status: "failed", post: failed as never });
    const { db } = makeDb(postRow({ status: "scheduled" }));
    await expect(publishNow(env(db), "post-1", actor)).resolves.toEqual({
      outcome: "x_failed",
      post: failed,
    });
  });

  it("maps a needs_confirmation X outcome to x_failed too", async () => {
    const uncertain = postRow({ status: "needs_confirmation", failure_reason: "network error" });
    runXPublish.mockResolvedValue({ status: "needs_confirmation", post: uncertain as never });
    const { db } = makeDb(postRow({ status: "scheduled" }));
    await expect(publishNow(env(db), "post-1", actor)).resolves.toEqual({
      outcome: "x_failed",
      post: uncertain,
    });
  });
});
