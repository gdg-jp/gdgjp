import { arrayMove } from "@dnd-kit/sortable";
import type { FlatNode, PageNode } from "~/features/pages/tree";

export const INDENT_WIDTH = 16;

export function getLocalizedTitle(
  node: { titleJa?: string | null; titleEn?: string | null },
  lang: string,
): string | undefined {
  return (lang === "en" ? node.titleEn || node.titleJa : node.titleJa || node.titleEn) ?? undefined;
}

export function findNodeIdBySlug(nodes: PageNode[], slug: string): string | null {
  for (const node of nodes) {
    if (node.slug === slug) return node.id;
    const found = findNodeIdBySlug(node.children, slug);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Projection helpers (drag-and-drop)
// ---------------------------------------------------------------------------
export function getProjection(
  items: FlatNode[],
  activeId: string,
  overId: string,
  offsetLeft: number,
): { depth: number; parentId: string | null; insertAfterId: string | null } | null {
  const activeIndex = items.findIndex((n) => n.id === activeId);
  const overIndex = items.findIndex((n) => n.id === overId);
  if (activeIndex === -1 || overIndex === -1) return null;

  const activeItem = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);
  const previousItem = newItems[overIndex - 1] ?? null;
  const nextItem = newItems[overIndex + 1] ?? null;

  const dragDepth = Math.round(offsetLeft / INDENT_WIDTH);
  const projectedDepth = activeItem.depth + dragDepth;
  const maxDepth = previousItem ? previousItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  const depth = Math.min(maxDepth, Math.max(minDepth, projectedDepth));

  function getParentId(): string | null {
    if (depth === 0 || !previousItem) return null;
    if (depth > previousItem.depth) return previousItem.id;
    const ancestor = newItems
      .slice(0, overIndex)
      .reverse()
      .find((item) => item.depth === depth - 1);
    return ancestor?.id ?? null;
  }

  const parentId = getParentId();

  function getInsertAfterId(): string | null {
    for (let i = overIndex - 1; i >= 0; i--) {
      const item = newItems[i];
      if (item.id === activeId) continue;
      if (item.depth === depth && item.parentId === parentId) return item.id;
      if (item.depth < depth) break;
    }
    return null;
  }

  return { depth, parentId, insertAfterId: getInsertAfterId() };
}

export function applyDragResult(
  items: FlatNode[],
  activeId: string,
  newParentId: string | null,
  insertAfterId: string | null,
  newDepth: number,
): FlatNode[] {
  const activeIndex = items.findIndex((n) => n.id === activeId);
  if (activeIndex === -1) return items;

  const activeItem = items[activeIndex];
  const depthChange = newDepth - activeItem.depth;

  // Collect the subtree (active + descendants)
  let subtreeEnd = items.length;
  for (let i = activeIndex + 1; i < items.length; i++) {
    if (items[i].depth <= activeItem.depth) {
      subtreeEnd = i;
      break;
    }
  }
  const subtree = items.slice(activeIndex, subtreeEnd).map((n, i) => ({
    ...n,
    depth: n.depth + depthChange,
    parentId: i === 0 ? newParentId : n.parentId,
  }));

  // Remove subtree from list
  const remaining = [...items.slice(0, activeIndex), ...items.slice(subtreeEnd)];

  // Find insertion point
  let insertIndex: number;
  if (!insertAfterId) {
    if (!newParentId) {
      insertIndex = 0;
    } else {
      const parentIdx = remaining.findIndex((n) => n.id === newParentId);
      insertIndex = parentIdx === -1 ? 0 : parentIdx + 1;
    }
  } else {
    const insertAfterIdx = remaining.findIndex((n) => n.id === insertAfterId);
    if (insertAfterIdx === -1) {
      insertIndex = remaining.length;
    } else {
      const insertAfterDepth = remaining[insertAfterIdx].depth;
      let i = insertAfterIdx + 1;
      while (i < remaining.length && remaining[i].depth > insertAfterDepth) i++;
      insertIndex = i;
    }
  }

  return [...remaining.slice(0, insertIndex), ...subtree, ...remaining.slice(insertIndex)];
}
