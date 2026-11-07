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
  orderSiblings(roots, true);
  return roots;
}

const DATED_SLUG = /^(\d{4}-\d{2}-\d{2})-/;

/**
 * Reading order for the sidebar: at the root, pages with children (the namespaces) come
 * before single pages; wherever two or more siblings carry a date-prefixed slug (events),
 * those are newest first, ahead of undated siblings. Everything else keeps its sort order.
 */
export function orderSiblings(nodes: PageNode[], root = false): void {
  const dated = nodes.filter((node) => DATED_SLUG.test(node.slug));
  if (dated.length >= 2) {
    const undated = nodes.filter((node) => !DATED_SLUG.test(node.slug));
    dated.sort((a, b) => {
      const ad = DATED_SLUG.exec(a.slug)?.[1] ?? "";
      const bd = DATED_SLUG.exec(b.slug)?.[1] ?? "";
      return bd.localeCompare(ad);
    });
    nodes.splice(0, nodes.length, ...dated, ...undated);
  } else if (root) {
    const branches = nodes.filter((node) => node.children.length > 0);
    const leaves = nodes.filter((node) => node.children.length === 0);
    nodes.splice(0, nodes.length, ...branches, ...leaves);
  }
  for (const node of nodes) orderSiblings(node.children);
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

/**
 * Returns the IDs of every ancestor required to reveal a page in the tree.
 * The matched page itself is deliberately excluded, so visiting a folder does
 * not automatically reveal its children.
 */
export function getAncestorIdsForSlug(nodes: PageNode[], slug?: string): Set<string> {
  if (!slug) return new Set();

  function visit(node: PageNode, ancestors: string[]): Set<string> | null {
    if (node.slug === slug) return new Set(ancestors);

    for (const child of node.children) {
      const result = visit(child, [...ancestors, node.id]);
      if (result) return result;
    }
    return null;
  }

  for (const node of nodes) {
    const result = visit(node, []);
    if (result) return result;
  }
  return new Set();
}

/**
 * Walk an in-memory page tree and produce root→leaf slug segments per page id.
 * Used by the sidebar so hierarchical links need no extra DB round trip.
 */
export function buildSlugPathById(nodes: PageNode[]): Map<string, string[]> {
  const paths = new Map<string, string[]>();

  function visit(node: PageNode, ancestors: string[]) {
    const segments = [...ancestors, node.slug];
    paths.set(node.id, segments);
    for (const child of node.children) {
      visit(child, segments);
    }
  }

  for (const node of nodes) {
    visit(node, []);
  }
  return paths;
}
