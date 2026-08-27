import { describe, expect, it } from "vitest";
import { createFolder, listAccessibleFoldersPage } from "./folder.repository";

describe("folder feature repository", () => {
  it("copies parent permissions after creating a nested folder", async () => {
    const queries: string[] = [];
    const db = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() { return this; },
          async first() {
            if (query.startsWith("SELECT id, name")) return { id: 8, name: "parent", owner_user_id: "owner", parent_folder_id: null, created_at: 0, updated_at: 0 };
            if (query.startsWith("SELECT 1")) return { ok: 1 };
            if (query.startsWith("INSERT INTO folders")) return { id: 9, name: "child", owner_user_id: "owner", parent_folder_id: 8, created_at: 0, updated_at: 0 };
            return null;
          },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    } as unknown as D1Database;
    const result = await createFolder(db, { name: "child", parentFolderId: 8, actor: { userId: "owner", email: "owner@example.com", chapterIds: [] } });
    expect(result.ok).toBe(true);
    expect(queries.some((query) => query.includes("INSERT INTO folder_permissions"))).toBe(true);
  });

  it("uses limit plus one for a real cursor page", async () => {
    let bindings: unknown[] = [];
    const db = { prepare() { return { bind(...values: unknown[]) { bindings = values; return this; }, async all() { return { results: [] }; } }; } } as unknown as D1Database;
    await listAccessibleFoldersPage(db, { userId: "u", email: "u@example.com", chapterIds: [] }, { limit: 25, offset: 50 });
    expect(bindings.slice(-2)).toEqual([26, 50]);
  });
});
