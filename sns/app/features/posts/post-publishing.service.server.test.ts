import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/x-accounts/x-provider.server", () => ({
  accessTokenForAccount: vi.fn(async () => "token-abc"),
}));

const { runXPublish } = await import("./post-publishing.service.server");

type Row = Record<string, unknown>;

function postRow(over: Row = {}): Row {
  return {
    id: "post-1",
    chapter_id: 1,
    x_account_id: "acc-1",
    text: "hello world",
    scheduled_at: "2026-09-01T00:00:00.000Z",
    condition: "scheduled",
    // `runXPublish` requires the row to already be claimed.
    status: "posting",
    created_by_user_id: "u1",
    published_x_post_id: null,
    published_at: null,
    failure_reason: "X post failed (500)",
    link_preview_url: null,
    link_preview_title: null,
    link_preview_description: null,
    link_preview_image_url: null,
    created_at: "t0",
    updated_at: "t0",
    ...over,
  };
}

/** `posts`/`post_media`/`post_media_tags`/`post_attempts` fake for `runXPublish`. */
function makeDb(seed: Row) {
  const post = { ...seed };
  const attempts: Row[] = [];

  function prepare(sql: string) {
    const stmt = {
      _bound: [] as unknown[],
      bind(...values: unknown[]) {
        stmt._bound = values;
        return stmt;
      },
      first: async <T>() => {
        if (sql.startsWith("SELECT * FROM posts WHERE id = ?")) {
          return (post.id === stmt._bound[0] ? post : null) as T | null;
        }
        throw new Error(`Unhandled first SQL: ${sql}`);
      },
      all: async <T>() => {
        if (sql.includes("FROM post_media WHERE post_id IN")) return { results: [] as T[] };
        if (sql.startsWith("SELECT x_user_id FROM post_media_tags")) return { results: [] as T[] };
        throw new Error(`Unhandled all SQL: ${sql}`);
      },
      run: async () => {
        if (sql.startsWith("UPDATE posts SET status = 'published'")) {
          if (post.status !== "posting") return { meta: { changes: 0 } };
          post.status = "published";
          post.published_x_post_id = stmt._bound[0];
          post.published_at = stmt._bound[1];
          if (sql.includes("failure_reason = NULL")) post.failure_reason = null;
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE posts SET status = ?")) {
          post.status = stmt._bound[0];
          post.failure_reason = stmt._bound[1];
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO post_attempts")) {
          attempts.push({ outcome: stmt._bound[3], detail: stmt._bound[4] });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unhandled run SQL: ${sql}`);
      },
    };
    return stmt;
  }

  return { db: { prepare } as unknown as D1Database, row: () => post, attempts: () => attempts };
}

const env = (db: D1Database) =>
  ({ DB: db, MEDIA: {}, X_API_BASE_URL: "https://api.x.test" }) as unknown as Env;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: { id: "x-123" } }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runXPublish", () => {
  it("clears a stale failure_reason when a retried failed post publishes", async () => {
    const { db, row, attempts } = makeDb(postRow({ failure_reason: "X post failed (500)" }));

    const result = await runXPublish(env(db), "post-1");

    expect(result.status).toBe("published");
    expect(result.post.failureReason).toBeNull();
    expect(row().failure_reason).toBeNull();
    expect(row().published_x_post_id).toBe("x-123");
    expect(attempts()).toEqual([{ outcome: "published", detail: null }]);
  });

  it("persists failed with the error detail when the X call is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "boom" }), { status: 500 })),
    );
    const { db, row } = makeDb(postRow({ failure_reason: null }));

    const result = await runXPublish(env(db), "post-1");

    expect(result.status).toBe("failed");
    expect(row().status).toBe("failed");
    expect(row().failure_reason).toBe("boom");
  });

  it("throws when handed a post that is not claimed", async () => {
    const { db } = makeDb(postRow({ status: "scheduled" }));
    await expect(runXPublish(env(db), "post-1")).rejects.toThrow(/requires a claimed post/);
  });
});
