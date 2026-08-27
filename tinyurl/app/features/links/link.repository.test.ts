import { describe, expect, it } from "vitest";
import {
  archiveLink,
  copyFolderPermissionsToLink,
  listVisibleLinksPage,
  restoreLink,
  updateLink,
} from "./link.repository";

describe("updateLink domain", () => {
  it("updates the domain and chapter ownership in one statement", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(query: string) {
        sql = query;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async first() {
            return null;
          },
        };
      },
    } as unknown as D1Database;

    await updateLink(db, "link_1", { domainId: 3, ownerChapterId: 42 });

    expect(sql).toContain("domain_id = ?");
    expect(sql).toContain("owner_chapter_id = ?");
    expect(bindings).toEqual([3, 42, "link_1"]);
  });
});

describe("archiveLink", () => {
  it("archives an active link without deleting it", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(query: string) {
        sql = query;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    await archiveLink(db, "link_active");

    expect(sql).toContain("archived_at = unixepoch()");
    expect(sql).toContain("updated_at = unixepoch()");
    expect(sql).toContain("archived_at IS NULL");
    expect(sql).toContain("deleted_at IS NULL");
    expect(bindings).toEqual(["link_active"]);
  });
});

describe("restoreLink", () => {
  it("restores an archived link without changing deleted links", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(query: string) {
        sql = query;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    await restoreLink(db, "link_archived");

    expect(sql).toContain("archived_at = NULL");
    expect(sql).toContain("updated_at = unixepoch()");
    expect(sql).toContain("archived_at IS NOT NULL");
    expect(sql).toContain("deleted_at IS NULL");
    expect(bindings).toEqual(["link_archived"]);
  });
});

describe("copyFolderPermissionsToLink", () => {
  it("copies folder permissions to a new link without overwriting explicit permissions", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(query: string) {
        sql = query;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    await copyFolderPermissionsToLink(db, 8, "link_1");

    expect(sql).toContain("SELECT ?, principal_type, principal_id, role FROM folder_permissions");
    expect(sql).toContain("ON CONFLICT(link_id, principal_type, principal_id) DO NOTHING");
    expect(bindings).toEqual(["link_1", 8]);
  });
});

describe("listVisibleLinksPage", () => {
  it("uses limit plus one instead of reading the entire visible set", async () => {
    let bindings: unknown[] = [];
    const db = {
      prepare() {
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;

    await listVisibleLinksPage(db, {
      userId: "u",
      email: "u@example.com",
      chapterIds: [],
      limit: 10,
      offset: 20,
    });

    expect(bindings.slice(-2)).toEqual([11, 20]);
  });
});
