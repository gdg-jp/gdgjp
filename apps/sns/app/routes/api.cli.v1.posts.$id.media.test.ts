import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "./+types/api.cli.v1.posts.$id.media";
import { action } from "./api.cli.v1.posts.$id.media";

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

const migrations = new URL("../../migrations/", import.meta.url);

function postWithImage() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(fileURLToPath(migrations)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO x_accounts (id, chapter_id, x_user_id, username, display_name, access_token_ciphertext,
      authorized_by_user_id, created_at, updated_at)
    VALUES ('acc-1', 1, 'x-1', 'gdg', 'GDG', 'fixture-not-encrypted', 'u1', 't0', 't0');
    INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status,
      created_by_user_id, created_at, updated_at)
    VALUES ('post-1', 1, 'acc-1', 'Photo post', '2099-12-31T03:00:00.000Z', 'scheduled',
      'scheduled', 'u1', 't0', 't0');
    INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, sort_order, created_at)
    VALUES ('m-0', 'post-1', '1/post-1/first', 'image/png', 99, 0, 't0');
  `);
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => ({
      success: true,
      meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) },
    }),
  });
  const media = { put: vi.fn(async () => null), delete: vi.fn(async () => {}) };
  const env = {
    DB: { prepare: (sql: string) => statement(sql) },
    MEDIA: media,
  } as unknown as Env;
  const sortOrders = () =>
    sqlite
      .prepare("SELECT sort_order FROM post_media ORDER BY sort_order")
      .all()
      .map((row) => row.sort_order);
  return { env, media, sortOrders };
}

function upload(env: Env, fields: Record<string, string>) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(99)], "photo.png", { type: "image/png" }));
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const request = new Request("https://sns.gdgs.jp/api/cli/v1/posts/post-1/media", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: form,
  });
  return action({
    request,
    params: { id: "post-1" },
    context: { cloudflare: { env, ctx: {} } },
  } as unknown as Route.ActionArgs);
}

describe("POST /api/cli/v1/posts/:id/media sortOrder", () => {
  it.each([
    ["missing", {}],
    ["empty", { sortOrder: "" }],
    ["negative", { sortOrder: "-1" }],
    ["fractional", { sortOrder: "1.5" }],
  ])("rejects a %s sortOrder as a bad request without storing anything", async (_, fields) => {
    const { env, media, sortOrders } = postWithImage();

    const response = await upload(env, fields);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(sortOrders()).toEqual([0]);
    expect(media.put).not.toHaveBeenCalled();
  });

  it("rejects a position outside the four image slots", async () => {
    const { env, sortOrders } = postWithImage();

    const response = await upload(env, { sortOrder: "4" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_sort_order" });
    expect(sortOrders()).toEqual([0]);
  });

  it("reports a position the post already uses as a conflict", async () => {
    const { env, media, sortOrders } = postWithImage();

    const response = await upload(env, { sortOrder: "0" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "sort_order_taken" });
    expect(sortOrders()).toEqual([0]);
    expect(media.put).not.toHaveBeenCalled();
  });

  it("attaches the image at a free position", async () => {
    const { env, sortOrders } = postWithImage();

    const response = await upload(env, { sortOrder: "1", altText: "Second photo" });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      media: { sortOrder: 1, altText: "Second photo", contentType: "image/png", byteSize: 99 },
    });
    expect(sortOrders()).toEqual([0, 1]);
  });
});
