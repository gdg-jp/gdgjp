import type { AuthUser } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishNowResult } from "~/features/posts/publish-now.service.server";
import type { Route } from "./+types/api.cli.v1.posts.$id.publish";
import { action, loader } from "./api.cli.v1.posts.$id.publish";

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

const publishNow = vi.fn<(env: Env, id: string, actor: unknown) => Promise<PublishNowResult>>();
vi.mock("~/features/posts/publish-now.service.server", () => ({
  publishNow: (env: Env, id: string, actor: unknown) => publishNow(env, id, actor),
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

function makeDb(seed: Row | null) {
  const post = seed ? { ...seed } : null;
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
    };
    return stmt;
  }
  return { prepare } as unknown as D1Database;
}

function actionArgs(request: Request, db: D1Database): Route.ActionArgs {
  return {
    request,
    params: { id: "post-1" },
    context: { cloudflare: { env: { DB: db } as unknown as Env, ctx: {} } },
  } as unknown as Route.ActionArgs;
}

const url = "https://sns.gdgs.jp/api/cli/v1/posts/post-1/publish";

beforeEach(() => {
  publishNow.mockReset();
});

describe("POST /api/cli/v1/posts/:id/publish", () => {
  it("returns 200 { post } when the post is published", async () => {
    const published = postRow({ status: "published", published_x_post_id: "x1" });
    publishNow.mockResolvedValue({ outcome: "published", post: published as never });
    const res = await action(actionArgs(new Request(url, { method: "POST" }), makeDb(postRow())));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ post: published });
  });

  it("returns 502 { post } carrying the persisted failed post on an X-side failure", async () => {
    const failed = postRow({ status: "failed", failure_reason: "X post failed (500)" });
    publishNow.mockResolvedValue({ outcome: "x_failed", post: failed as never });
    const res = await action(actionArgs(new Request(url, { method: "POST" }), makeDb(postRow())));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ post: failed });
  });

  it("returns 409 for a post already published — never a second X post", async () => {
    publishNow.mockResolvedValue({ outcome: "conflict", code: "already_published" });
    const res = await action(
      actionArgs(new Request(url, { method: "POST" }), makeDb(postRow({ status: "published" }))),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "already_published" });
  });

  it("returns 409 for a post already posting", async () => {
    publishNow.mockResolvedValue({ outcome: "conflict", code: "already_posting" });
    const res = await action(
      actionArgs(new Request(url, { method: "POST" }), makeDb(postRow({ status: "posting" }))),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "already_posting" });
  });

  it("returns 409 when a photo_required post has no media", async () => {
    publishNow.mockResolvedValue({ outcome: "conflict", code: "missing_required_media" });
    const res = await action(actionArgs(new Request(url, { method: "POST" }), makeDb(postRow())));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "missing_required_media" });
  });

  it("404s an unknown post id before calling the service", async () => {
    const res = await action(actionArgs(new Request(url, { method: "POST" }), makeDb(null)));
    expect(res.status).toBe(404);
    expect(publishNow).not.toHaveBeenCalled();
  });

  it("returns a JSON 405 for GET and for a non-POST action verb", async () => {
    const getRes = loader({} as never);
    expect(getRes.status).toBe(405);
    await expect(getRes.json()).resolves.toEqual({ error: "method_not_allowed" });

    const putRes = await action(actionArgs(new Request(url, { method: "PUT" }), makeDb(postRow())));
    expect(putRes.status).toBe(405);
  });
});
