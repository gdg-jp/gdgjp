import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChartPie,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  ListTodo,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { type FlatNode, type PageNode, flattenTree, getAncestorIdsForSlug } from "~/lib/page-tree";

export type { PageNode };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const INDENT_WIDTH = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getLocalizedTitle(
  node: { titleJa?: string | null; titleEn?: string | null },
  lang: string,
): string | undefined {
  return (lang === "en" ? node.titleEn || node.titleJa : node.titleJa || node.titleEn) ?? undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PageTreeProps {
  pages: PageNode[];
  currentSlug?: string;
  isCollapsed?: boolean;
  canReorder?: boolean;
  canCreate?: boolean;
}

// ---------------------------------------------------------------------------
// Projection helpers (drag-and-drop)
// ---------------------------------------------------------------------------
function getProjection(
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

function applyDragResult(
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

// ---------------------------------------------------------------------------
// SortableTreeItem — used when canReorder=true
// ---------------------------------------------------------------------------
function SortableTreeItem({
  node,
  depth,
  currentSlug,
  isDragging,
  isOverlay,
  showDropIndicator,
  indicatorDepth,
  isFolderCollapsed,
  onToggle,
}: {
  node: FlatNode;
  depth: number;
  currentSlug?: string;
  isDragging?: boolean;
  isOverlay?: boolean;
  showDropIndicator?: boolean;
  indicatorDepth?: number;
  isFolderCollapsed?: boolean;
  onToggle?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { listeners, setNodeRef, transform, transition } = useSortable({ id: node.id });
  const title = getLocalizedTitle(node, i18n.language);
  const isCurrent = node.slug === currentSlug;
  const hasChildren = node.children.length > 0;

  return (
    <li
      ref={setNodeRef}
      className="relative"
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {showDropIndicator && (
        <div
          className="pointer-events-none absolute top-0 right-0 z-10 h-0.5 bg-action-primary"
          style={{ left: `${(indicatorDepth ?? 0) * INDENT_WIDTH + 8}px` }}
        />
      )}
      <div
        {...listeners}
        style={{
          paddingLeft: `${depth * INDENT_WIDTH}px`,
          opacity: isDragging ? 0.3 : 1,
        }}
        className={`flex min-h-8 cursor-grab items-center gap-1 rounded px-1 py-1.5 text-sm active:cursor-grabbing ${
          isCurrent
            ? "bg-surface-selected font-medium text-action-primary"
            : "text-content-secondary hover:bg-surface-sunken"
        }${isOverlay ? " border border-default bg-surface-raised shadow-md" : ""}`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center text-content-tertiary hover:text-content-secondary"
            aria-label={isFolderCollapsed ? t("pageTree.expand") : t("pageTree.collapse")}
          >
            {isFolderCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <span className="h-4 w-4 flex-shrink-0" />
        )}

        <span className="flex-shrink-0 text-content-tertiary">
          {node.pageType === "task-list" ? (
            <ListTodo size={14} />
          ) : hasChildren ? (
            isFolderCollapsed ? (
              <Folder size={14} />
            ) : (
              <FolderOpen size={14} />
            )
          ) : (
            <FileText size={14} />
          )}
        </span>

        <Link
          to={node.pageType === "task-list" ? `/tasks/${node.slug}` : `/wiki/${node.slug}`}
          className="flex-1 truncate"
        >
          {title}
        </Link>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// DraggablePageTree — rendered when canReorder=true
// ---------------------------------------------------------------------------
function DraggablePageTree({
  pages,
  currentSlug,
  expandedIds,
  onToggle,
}: {
  pages: PageNode[];
  currentSlug?: string;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const [flatNodes, setFlatNodes] = useState<FlatNode[]>(() => flattenTree(pages));
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Build visible list: first hide descendants of collapsed nodes, then hide descendants of active during drag
  const sortableItems = useMemo(() => {
    // Step 1: apply collapsed-folder filter
    const visible: FlatNode[] = [];
    let skipBelowDepth: number | null = null;
    for (const node of flatNodes) {
      if (skipBelowDepth !== null && node.depth > skipBelowDepth) continue;
      skipBelowDepth = null;
      visible.push(node);
      if (!expandedIds.has(node.id) && node.children.length > 0) skipBelowDepth = node.depth;
    }
    // Step 2: during drag, also hide descendants of the active item
    if (!activeId) return visible;
    const activeIndex = visible.findIndex((n) => n.id === activeId);
    if (activeIndex === -1) return visible;
    const activeDepth = visible[activeIndex].depth;
    return visible.filter((n, i) => i <= activeIndex || n.depth <= activeDepth);
  }, [flatNodes, activeId, expandedIds]);

  const projected = useMemo(() => {
    if (!activeId || !overId) return null;
    return getProjection(sortableItems, String(activeId), String(overId), dragOffsetX);
  }, [sortableItems, activeId, overId, dragOffsetX]);

  const activeNode = activeId ? (sortableItems.find((n) => n.id === activeId) ?? null) : null;

  function resetState() {
    setActiveId(null);
    setOverId(null);
    setDragOffsetX(0);
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(active.id);
    setOverId(active.id);
    setDragOffsetX(0);
  }

  function handleDragMove({ delta }: DragMoveEvent) {
    setDragOffsetX(delta.x);
  }

  function handleDragOver({ over }: DragOverEvent) {
    setOverId(over?.id ?? null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || !projected) {
      resetState();
      return;
    }

    const { parentId: newParentId, insertAfterId, depth } = projected;
    const currentNode = flatNodes.find((n) => n.id === active.id);
    // Skip if nothing changed
    if (currentNode && currentNode.parentId === newParentId && active.id === over.id) {
      resetState();
      return;
    }

    setFlatNodes((prev) =>
      applyDragResult(prev, String(active.id), newParentId, insertAfterId, depth),
    );
    fetcher.submit(
      { pageId: String(active.id), newParentId, insertAfterId },
      { method: "POST", action: "/api/pages/reorder", encType: "application/json" },
    );
    resetState();
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={resetState}
    >
      <SortableContext
        items={sortableItems.map((n) => n.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {sortableItems.map((node) => (
            <SortableTreeItem
              key={node.id}
              node={node}
              depth={node.depth}
              currentSlug={currentSlug}
              isDragging={node.id === activeId}
              showDropIndicator={Boolean(projected) && overId === node.id && overId !== activeId}
              indicatorDepth={projected?.depth}
              isFolderCollapsed={!expandedIds.has(node.id)}
              onToggle={() => onToggle(node.id)}
            />
          ))}
          {sortableItems.length === 0 && (
            <li className="px-2 py-1 text-xs text-content-tertiary">{t("pageTree.noPages")}</li>
          )}
        </ul>
      </SortableContext>

      <DragOverlay>
        {activeNode && (
          <ul>
            <SortableTreeItem
              node={activeNode}
              depth={projected?.depth ?? activeNode.depth}
              currentSlug={currentSlug}
              isOverlay
            />
          </ul>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// TreeNode — used when canReorder=false (original behavior)
// ---------------------------------------------------------------------------
interface TreeNodeProps {
  node: PageNode;
  currentSlug?: string;
  expandedIds: Set<string>;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
}

function TreeNode({ node, currentSlug, expandedIds, isCollapsed, onToggle }: TreeNodeProps) {
  const { t, i18n } = useTranslation();
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const isCurrent = node.slug === currentSlug;
  const title = getLocalizedTitle(node, i18n.language);

  return (
    <li>
      <div
        title={isCollapsed ? title : undefined}
        className={`flex min-h-8 items-center gap-1 rounded px-2 py-1.5 text-sm ${
          isCurrent
            ? "bg-surface-selected font-medium text-action-primary"
            : "text-content-secondary hover:bg-surface-sunken"
        }`}
      >
        {!isCollapsed &&
          (hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-content-tertiary hover:text-content-secondary"
              aria-label={expanded ? t("pageTree.collapse") : t("pageTree.expand")}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="h-4 w-4 flex-shrink-0" />
          ))}

        <span className="flex-shrink-0 text-content-tertiary">
          {node.pageType === "task-list" ? (
            <ListTodo size={14} />
          ) : hasChildren ? (
            expanded ? (
              <FolderOpen size={14} />
            ) : (
              <Folder size={14} />
            )
          ) : (
            <FileText size={14} />
          )}
        </span>

        {!isCollapsed && (
          <Link
            to={node.pageType === "task-list" ? `/tasks/${node.slug}` : `/wiki/${node.slug}`}
            className="flex-1 truncate"
          >
            {title}
          </Link>
        )}
      </div>

      {hasChildren && expanded && !isCollapsed && (
        <ul className="ml-4">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              currentSlug={currentSlug}
              expandedIds={expandedIds}
              isCollapsed={isCollapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// PageTree — public component
// ---------------------------------------------------------------------------
export default function PageTree({
  pages,
  currentSlug,
  isCollapsed = false,
  canReorder = false,
  canCreate = true,
}: PageTreeProps) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef(pages);
  const [expandedIds, setExpandedIds] = useState(() => getAncestorIdsForSlug(pages, currentSlug));

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    setExpandedIds(getAncestorIdsForSlug(pagesRef.current, currentSlug));
    // The tree can revalidate without a navigation; only the destination should reset manual state.
  }, [currentSlug]);

  function toggleExpanded(id: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [dropdownOpen]);

  return (
    <nav aria-label="Page tree" className="flex h-full flex-col py-2">
      {canReorder ? (
        <DraggablePageTree
          pages={pages}
          currentSlug={currentSlug}
          expandedIds={expandedIds}
          onToggle={toggleExpanded}
        />
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {pages.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              currentSlug={currentSlug}
              expandedIds={expandedIds}
              isCollapsed={isCollapsed}
              onToggle={toggleExpanded}
            />
          ))}
          {pages.length === 0 && !isCollapsed && (
            <li className="px-2 py-1 text-xs text-content-tertiary">{t("pageTree.noPages")}</li>
          )}
        </ul>
      )}

      {canCreate && (
        <div className="relative border-t border-subtle px-2 pt-2 pb-1" ref={dropdownRef}>
          <button
            type="button"
            title={isCollapsed ? t("pageTree.newPage") : undefined}
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex min-h-8 w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-content-secondary hover:bg-surface-sunken hover:text-action-primary"
          >
            <Plus size={14} className="flex-shrink-0" />
            {!isCollapsed && <span>{t("pageTree.newPage")}</span>}
          </button>

          {dropdownOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-md border border-default bg-surface-raised shadow-md">
              <Link
                to="/ingest"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-canvas"
              >
                <span>✦</span>
                <span>{t("pageTree.newPage_ai")}</span>
              </Link>
              <Link
                to="/analyze"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-canvas"
              >
                <ChartPie size={14} />
                <span>{t("pageTree.newPage_analyze")}</span>
              </Link>
              <Link
                to="/wiki/new"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-canvas"
              >
                <span>✎</span>
                <span>{t("pageTree.newPage_manual")}</span>
              </Link>
              <Link
                to="/tasks/new"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-canvas"
              >
                <ListTodo size={14} />
                <span>{t("pageTree.newTaskList")}</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
