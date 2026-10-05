import { describe, expect, it } from "vitest";
import { type AdminPageRow, buildAdminPageTree } from "./admin-page-tree";

function createRow(overrides: Partial<AdminPageRow> & { id: string; slug: string }): AdminPageRow {
  return {
    titleJa: overrides.slug,
    titleEn: null,
    status: "published",
    visibility: "public",
    authorId: "user-1",
    authorName: "Alice",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    parentId: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("buildAdminPageTree", () => {
  it("computes correct depth and wikiPath for a 2-level parent-child hierarchy", () => {
    const rows: AdminPageRow[] = [
      createRow({ id: "p1", slug: "parent", titleJa: "親" }),
      createRow({ id: "p2", slug: "child", titleJa: "子", parentId: "p1" }),
    ];

    const result = buildAdminPageTree(rows);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "p1",
      slug: "parent",
      depth: 0,
      wikiPath: "/wiki/parent",
      childCount: 1,
    });
    expect(result[1]).toMatchObject({
      id: "p2",
      slug: "child",
      depth: 1,
      wikiPath: "/wiki/parent/child",
      childCount: 0,
    });
  });

  it("handles multi-level hierarchy (3 levels) with chained wikiPath", () => {
    const rows: AdminPageRow[] = [
      createRow({ id: "p1", slug: "root", titleJa: "ルート" }),
      createRow({ id: "p2", slug: "child", titleJa: "子", parentId: "p1" }),
      createRow({ id: "p3", slug: "grandchild", titleJa: "孫", parentId: "p2" }),
    ];

    const result = buildAdminPageTree(rows);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: "p1",
      depth: 0,
      wikiPath: "/wiki/root",
      childCount: 1,
    });
    expect(result[1]).toMatchObject({
      id: "p2",
      depth: 1,
      wikiPath: "/wiki/root/child",
      childCount: 1,
    });
    expect(result[2]).toMatchObject({
      id: "p3",
      depth: 2,
      wikiPath: "/wiki/root/child/grandchild",
      childCount: 0,
    });
  });

  it("treats orphans as roots with /wiki/<slug> wikiPath and depth 0", () => {
    const rows: AdminPageRow[] = [
      createRow({ id: "orphan1", slug: "orphan-page", parentId: "nonexistent-parent" }),
    ];

    const result = buildAdminPageTree(rows);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "orphan1",
      slug: "orphan-page",
      depth: 0,
      wikiPath: "/wiki/orphan-page",
      childCount: 0,
    });
  });

  it("counts only direct children in childCount", () => {
    const rows: AdminPageRow[] = [
      createRow({ id: "parent", slug: "parent" }),
      createRow({ id: "child1", slug: "child1", parentId: "parent" }),
      createRow({ id: "child2", slug: "child2", parentId: "parent" }),
      createRow({ id: "grandchild", slug: "grandchild", parentId: "child1" }),
    ];

    const result = buildAdminPageTree(rows);

    const parentNode = result.find((n) => n.id === "parent");
    const child1Node = result.find((n) => n.id === "child1");
    const child2Node = result.find((n) => n.id === "child2");
    const grandchildNode = result.find((n) => n.id === "grandchild");

    expect(parentNode?.childCount).toBe(2);
    expect(child1Node?.childCount).toBe(1);
    expect(child2Node?.childCount).toBe(0);
    expect(grandchildNode?.childCount).toBe(0);
  });

  it("orders siblings by sortOrder regardless of input array order", () => {
    const rows: AdminPageRow[] = [
      createRow({ id: "child-b", slug: "b", parentId: "root", sortOrder: 20 }),
      createRow({ id: "root", slug: "root", sortOrder: 0 }),
      createRow({ id: "child-a", slug: "a", parentId: "root", sortOrder: 10 }),
    ];

    const result = buildAdminPageTree(rows);

    expect(result.map((n) => n.id)).toEqual(["root", "child-a", "child-b"]);
  });
});
