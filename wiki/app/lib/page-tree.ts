export interface PageNode {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  parentId: string | null;
  pageType?: string | null;
  children: PageNode[];
}

export interface FlatNode {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  parentId: string | null;
  pageType?: string | null;
  depth: number;
  children: PageNode[];
}

export type FlatRow = {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  parentId: string | null;
  pageType?: string | null;
  sortOrder: number;
};

/**
 * Converts a flat list of page rows (with parentId) into a recursive tree.
 * Orphaned nodes (parentId pointing to a non-existent page) are placed at the root.
 */
export function buildTree(rows: FlatRow[]): PageNode[] {
  const map = new Map<string, PageNode>();
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      slug: row.slug,
      titleJa: row.titleJa,
      titleEn: row.titleEn,
      parentId: row.parentId,
      pageType: row.pageType ?? null,
      children: [],
    });
  }

  const roots: PageNode[] = [];
  for (const row of rows) {
    const node = map.get(row.id);
    if (!node) continue;
    if (row.parentId && map.has(row.parentId)) {
      map.get(row.parentId)?.children.push(node);
    } else {
      node.parentId = null; // treat orphans as roots
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Flattens a recursive PageNode tree into a flat list suitable for drag-and-drop.
 * The parentId in FlatNode reflects the actual tree structure (not raw DB value).
 */
export function flattenTree(
  nodes: PageNode[],
  parentId: string | null = null,
  depth = 0,
): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    result.push({
      id: node.id,
      slug: node.slug,
      titleJa: node.titleJa,
      titleEn: node.titleEn,
      parentId,
      pageType: node.pageType,
      depth,
      children: node.children,
    });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, node.id, depth + 1));
    }
  }
  return result;
}
