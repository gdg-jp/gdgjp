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
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { type FlatNode, type PageNode, flattenTree } from "~/features/pages/tree";
import { applyDragResult, getProjection } from "./build-tree";
import { SortableTreeItem } from "./row";

// ---------------------------------------------------------------------------
// DraggablePageTree — rendered when canReorder=true
// ---------------------------------------------------------------------------
export function DraggablePageTree({
  pages,
  currentSlug,
  pathById,
  expandedIds,
  onToggle,
}: {
  pages: PageNode[];
  currentSlug?: string;
  pathById: Map<string, string[]>;
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
              pathById={pathById}
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
              pathById={pathById}
              isOverlay
            />
          </ul>
        )}
      </DragOverlay>
    </DndContext>
  );
}
