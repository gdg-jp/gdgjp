import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";

const testDb = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("~/lib/db.server", () => ({ getDb: () => testDb.current }));
vi.mock("~/features/auth/utils.server", () => ({
  requireUser: async () => ({
    id: "alice",
    email: "alice@example.com",
    name: "Alice",
    image: null,
    isAdmin: false,
  }),
  getAccessIdentity: async () => ({ chapters: [] }),
}));
vi.mock("~/features/pages/access.server", () => ({
  getEffectivePagePermissions: async (_db: unknown, page: { authorId: string }) => ({
    canView: true,
    canEdit: page.authorId === "alice",
  }),
}));

import { action } from "./reorder";

let sqlite: ReturnType<typeof createSpacesTestDb>["sqlite"];

beforeEach(() => {
  const created = createSpacesTestDb();
  testDb.current = created.db;
  sqlite = created.sqlite;
  sqlite.exec(`
    INSERT INTO pages (id, title_ja, slug, content_ja, author_id, last_edited_by, visibility) VALUES
      ('list-a', 'A', 'list-a', '', 'alice', 'alice', 'public'),
      ('list-b', 'B', 'list-b', '', 'bob', 'bob', 'public');
    INSERT INTO task_lists (page_id) VALUES ('list-a'), ('list-b');
    INSERT INTO tasks (id, task_list_id, number, title, created_by, sort_order) VALUES
      ('a1', 'list-a', 1, 'a1', 'alice', 0),
      ('a2', 'list-a', 2, 'a2', 'alice', 1),
      ('b1', 'list-b', 1, 'b1', 'bob', 0),
      ('b2', 'list-b', 2, 'b2', 'bob', 1);
  `);
});

function reorder(taskListId: string, orderedIds: string[]) {
  const request = new Request(`http://localhost/api/tasks/${taskListId}/reorder`, {
    method: "POST",
    body: JSON.stringify({ orderedIds }),
  });
  return action({
    request,
    params: { taskListId },
    context: { cloudflare: { env: {} as Env } } as never,
    unstable_pattern: "/api/tasks/:taskListId/reorder",
    unstable_url: new URL(request.url),
  });
}

function sortOrders() {
  return Object.fromEntries(
    sqlite
      .prepare("SELECT id, sort_order FROM tasks ORDER BY id")
      .all()
      .map((row) => [row.id, row.sort_order]),
  );
}

describe("POST /api/tasks/:taskListId/reorder", () => {
  it("rejects ids from another list and leaves every list untouched", async () => {
    const response = await reorder("list-a", ["b2", "a2", "b1", "a1"]);
    expect(response.status).toBe(400);
    expect(sortOrders()).toEqual({ a1: 0, a2: 1, b1: 0, b2: 1 });
  });

  it("reorders a list whose ids all belong to it", async () => {
    const response = await reorder("list-a", ["a2", "a1"]);
    expect(response.status).toBe(200);
    expect(sortOrders()).toEqual({ a1: 1, a2: 0, b1: 0, b2: 1 });
  });
});
