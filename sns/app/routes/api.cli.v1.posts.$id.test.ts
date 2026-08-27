import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "./+types/api.cli.v1.posts.$id";
import { action } from "./api.cli.v1.posts.$id";

vi.mock("~/features/auth/cli-access.server", () => ({
  requireCliSnsAccess: vi.fn(async () => ({
    user: {
      id: "u1",
      email: "org@example.com",
      name: "Org",
      image: null,
      isAdmin: false,
    } as AuthUser,
    role: "organizer" as const,
  })),
}));

type Row = Record<string, unknown>;

function postRow(over: Row = {}): Row {
  return {
    id: "post-1",
    chapter_id: 1,
    x_account_id: "acc-1",
    text: "hello",
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

/** Minimal `posts`/`post_media` fake covering only `deleteDraft`'s statements. */
function makeDb(seed: Row | null) {
  const post = seed ? { ...seed } : null;
  let deleteAttempted = false;

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
        if (sql.includes("FROM post_media WHERE post_id IN")) return { results: [] as T[] };
        throw new Error(`Unhandled all SQL: ${sql}`);
      },
      run: async () => {
        if (sql.startsWith("DELETE FROM posts WHERE id = ?")) {
          deleteAttempted = true;
          const deletable =
            post !== null && post.status !== "published" && post.status !== "posting";
          return { meta: { changes: deletable ? 1 : 0 } };
        }
        throw new Error(`Unhandled run SQL: ${sql}`);
      },
    };
    return stmt;
  }

  return { db: { prepare } as unknown as D1Database, wasDeleteAttempted: () => deleteAttempted };
}

function actionArgs(request: Request, db: D1Database): Route.ActionArgs {
  return {
    request,
    params: { id: "post-1" },
    context: { cloudflare: { env: { DB: db, MEDIA: {} } as unknown as Env, ctx: {} } },
  } as unknown as Route.ActionArgs;
}

const url = "https://sns.gdgs.jp/api/cli/v1/posts/post-1";

describe("DELETE /api/cli/v1/posts/:id", () => {
  it("rejects deleting a published post with 409 and the shared { error } shape", async () => {
    const { db } = makeDb(postRow({ status: "published" }));
    const res = await action(actionArgs(new Request(url, { method: "DELETE" }), db));

    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "not_deletable" });
  });

  it("also rejects a posting post with 409", async () => {
    const { db } = makeDb(postRow({ status: "posting" }));
    const res = await action(actionArgs(new Request(url, { method: "DELETE" }), db));
    expect(res.status).toBe(409);
  });

  it("deletes a scheduled draft and returns 200 { id, deleted: true }", async () => {
    const { db } = makeDb(postRow({ status: "scheduled" }));
    const res = await action(actionArgs(new Request(url, { method: "DELETE" }), db));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "post-1", deleted: true });
  });

  it("404s an unknown post id before any delete is attempted", async () => {
    const { db, wasDeleteAttempted } = makeDb(null);
    const res = await action(actionArgs(new Request(url, { method: "DELETE" }), db));

    expect(res.status).toBe(404);
    expect(wasDeleteAttempted()).toBe(false);
  });

  it("returns a JSON 405 for an unsupported method", async () => {
    const { db } = makeDb(postRow());
    const res = await action(actionArgs(new Request(url, { method: "PUT" }), db));
    expect(res.status).toBe(405);
    await expect(res.json()).resolves.toEqual({ error: "method_not_allowed" });
  });
});
