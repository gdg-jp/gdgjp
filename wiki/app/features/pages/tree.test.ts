import { describe, expect, it } from "vitest";
import { buildSlugPathById, buildTree, getAncestorIdsForSlug } from "./tree";

const row = (
  id: string,
  parentId: string | null,
  sortOrder = 0,
): {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  parentId: string | null;
  sortOrder: number;
} => ({
  id,
  slug: id,
  titleJa: `${id}-ja`,
  titleEn: `${id}-en`,
  parentId,
  sortOrder,
});

describe("buildTree", () => {
  it("returns empty array for no rows", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("returns flat list when all rows have no parent", () => {
    const result = buildTree([row("a", null), row("b", null), row("c", null)]);
    expect(result).toHaveLength(3);
    expect(result.map((n) => n.id)).toEqual(["a", "b", "c"]);
    for (const node of result) {
      expect(node.children).toHaveLength(0);
    }
  });

  it("nests children under their parent", () => {
    const result = buildTree([row("root", null), row("child1", "root"), row("child2", "root")]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("root");
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children.map((n) => n.id)).toEqual(["child1", "child2"]);
  });

  it("nests grandchildren correctly", () => {
    const result = buildTree([row("root", null), row("child", "root"), row("grandchild", "child")]);
    expect(result).toHaveLength(1);
    expect(result[0].children[0].children[0].id).toBe("grandchild");
  });

  it("treats orphaned nodes (missing parent) as roots", () => {
    const result = buildTree([row("child", "nonexistent")]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("child");
  });

  it("handles mixed roots and children", () => {
    const result = buildTree([row("r1", null), row("r2", null), row("c1", "r1"), row("c2", "r2")]);
    expect(result).toHaveLength(2);
    expect(result[0].children.map((n) => n.id)).toEqual(["c1"]);
    expect(result[1].children.map((n) => n.id)).toEqual(["c2"]);
  });
});

describe("getAncestorIdsForSlug", () => {
  const tree = buildTree([
    row("root", null),
    row("child", "root"),
    row("grandchild", "child"),
    row("other-root", null),
    row("other-child", "other-root"),
  ]);

  it("starts with every hierarchy collapsed when no page is active", () => {
    expect(getAncestorIdsForSlug(tree)).toEqual(new Set());
  });

  it("opens every ancestor needed to reveal a deeply nested page", () => {
    expect(getAncestorIdsForSlug(tree, "grandchild")).toEqual(new Set(["root", "child"]));
  });

  it("does not open the current page's descendants or unrelated branches", () => {
    expect(getAncestorIdsForSlug(tree, "child")).toEqual(new Set(["root"]));
    expect(getAncestorIdsForSlug(tree, "other-child")).toEqual(new Set(["other-root"]));
  });
});

describe("buildSlugPathById", () => {
  const tree = buildTree([
    row("root", null),
    row("child", "root"),
    row("grandchild", "child"),
    row("other-root", null),
  ]);

  it("returns root→leaf slug segments for every node", () => {
    const paths = buildSlugPathById(tree);
    expect(paths.get("root")).toEqual(["root"]);
    expect(paths.get("child")).toEqual(["root", "child"]);
    expect(paths.get("grandchild")).toEqual(["root", "child", "grandchild"]);
    expect(paths.get("other-root")).toEqual(["other-root"]);
  });

  it("returns an empty map for an empty tree", () => {
    expect(buildSlugPathById([])).toEqual(new Map());
  });
});
