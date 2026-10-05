import { buildTree } from "~/features/pages/tree";
import type { FlatRow, PageNode } from "~/features/pages/tree";
import { wikiPagePath } from "~/features/pages/wiki-page-path";

export interface AdminPageRow {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string | null;
  status: string;
  visibility: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  parentId: string | null;
  sortOrder: number;
}

export interface AdminPageNode extends AdminPageRow {
  depth: number;
  wikiPath: string;
  childCount: number;
}

/**
 * Builds a flat list of admin page rows arranged in depth-first tree order,
 * with hierarchical wikiPath, depth, and childCount calculated.
 */
export function buildAdminPageTree(rows: AdminPageRow[]): AdminPageNode[] {
  const sortedRows = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const rowMap = new Map<string, AdminPageRow>();
  const flatRows: FlatRow[] = [];

  for (const row of sortedRows) {
    rowMap.set(row.id, row);
    flatRows.push({
      id: row.id,
      slug: row.slug,
      titleJa: row.titleJa,
      titleEn: row.titleEn ?? "",
      parentId: row.parentId,
      sortOrder: row.sortOrder,
    });
  }

  const tree = buildTree(flatRows);
  const result: AdminPageNode[] = [];

  function traverse(nodes: PageNode[], depth: number, ancestorSlugs: string[]) {
    for (const node of nodes) {
      const row = rowMap.get(node.id);
      if (!row) continue;
      const currentSlugs = [...ancestorSlugs, node.slug];
      result.push({
        ...row,
        depth,
        wikiPath: wikiPagePath(currentSlugs),
        childCount: node.children.length,
      });
      if (node.children.length > 0) {
        traverse(node.children, depth + 1, currentSlugs);
      }
    }
  }

  traverse(tree, 0, []);
  return result;
}
