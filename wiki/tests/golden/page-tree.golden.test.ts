import { describe, expect, it } from "vitest";
import { buildTree, flattenTree } from "~/lib/page-tree";

type FlatRow = {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  parentId: string | null;
  sortOrder: number;
};

function row(id: string, parentId: string | null, sortOrder = 0): FlatRow {
  return { id, slug: `/${id}`, titleJa: `${id}-ja`, titleEn: `${id}-en`, parentId, sortOrder };
}

describe("buildTree golden snapshots", () => {
  it("multi-level tree: 7 rows, 3 levels deep, two root nodes each with children", () => {
    const rows: FlatRow[] = [
      row("root1", null, 0),
      row("root2", null, 1),
      row("child1a", "root1", 0),
      row("child1b", "root1", 1),
      row("child2a", "root2", 0),
      row("grandchild1a1", "child1a", 0),
      row("grandchild1a2", "child1a", 1),
    ];
    expect(buildTree(rows)).toMatchSnapshot();
  });
});

describe("flattenTree golden snapshots", () => {
  it("flatten tree: 4 rows, 3 levels, checks depth and parentId preservation", () => {
    const rows: FlatRow[] = [
      row("root", null, 0),
      row("child", "root", 0),
      row("grandchild", "child", 0),
      row("sibling", "root", 1),
    ];
    const tree = buildTree(rows);
    expect(flattenTree(tree)).toMatchSnapshot();
  });
});
