import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, ListTodo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { FlatNode, PageNode } from "~/features/pages/tree";
import { wikiPagePath } from "~/features/pages/wiki-page-path";
import { INDENT_WIDTH, getLocalizedTitle } from "./build-tree";

// ---------------------------------------------------------------------------
// SortableTreeItem — used when canReorder=true
// ---------------------------------------------------------------------------
export function SortableTreeItem({
  node,
  depth,
  currentSlug,
  pathById,
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
  pathById: Map<string, string[]>;
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
        className={`relative flex min-h-8 items-center gap-1 rounded px-1 py-1.5 text-sm ${
          hasChildren ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
        } ${
          isCurrent
            ? "bg-surface-selected font-medium text-action-primary"
            : "text-content-secondary hover:bg-surface-sunken"
        }${isOverlay ? " border border-default bg-surface-raised shadow-md" : ""}`}
      >
        {hasChildren && (
          <button
            type="button"
            onClick={onToggle}
            className="absolute inset-0 z-0 rounded"
            aria-expanded={!isFolderCollapsed}
            aria-label={isFolderCollapsed ? t("pageTree.expand") : t("pageTree.collapse")}
          />
        )}

        {hasChildren ? (
          <span
            className="relative z-10 flex h-4 w-4 flex-shrink-0 items-center justify-center text-content-tertiary pointer-events-none"
            aria-hidden
          >
            {isFolderCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
        ) : (
          <span className="h-4 w-4 flex-shrink-0" />
        )}

        <span className="relative z-10 flex-shrink-0 text-content-tertiary pointer-events-none">
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
          to={
            node.pageType === "task-list"
              ? `/tasks/${node.slug}`
              : wikiPagePath(pathById.get(node.id) ?? [node.slug])
          }
          prefetch="intent"
          className="relative z-10 min-w-0 flex-1 truncate"
          onClick={() => {
            if (hasChildren) onToggle?.();
          }}
        >
          {title}
        </Link>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// TreeNode — used when canReorder=false (original behavior)
// ---------------------------------------------------------------------------
interface TreeNodeProps {
  node: PageNode;
  currentSlug?: string;
  pathById: Map<string, string[]>;
  expandedIds: Set<string>;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
}

export function TreeNode({
  node,
  currentSlug,
  pathById,
  expandedIds,
  isCollapsed,
  onToggle,
}: TreeNodeProps) {
  const { t, i18n } = useTranslation();
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const isCurrent = node.slug === currentSlug;
  const title = getLocalizedTitle(node, i18n.language);

  return (
    <li>
      <div
        title={isCollapsed ? title : undefined}
        className={`relative flex min-h-8 items-center gap-1 rounded px-2 py-1.5 text-sm ${
          hasChildren ? "cursor-pointer" : ""
        } ${
          isCurrent
            ? "bg-surface-selected font-medium text-action-primary"
            : "text-content-secondary hover:bg-surface-sunken"
        }`}
      >
        {hasChildren && !isCollapsed && (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="absolute inset-0 z-0 rounded"
            aria-expanded={expanded}
            aria-label={expanded ? t("pageTree.collapse") : t("pageTree.expand")}
          />
        )}

        {!isCollapsed &&
          (hasChildren ? (
            <span
              className="relative z-10 flex h-4 w-4 flex-shrink-0 items-center justify-center text-content-tertiary pointer-events-none"
              aria-hidden
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          ) : (
            <span className="h-4 w-4 flex-shrink-0" />
          ))}

        <span className="relative z-10 flex-shrink-0 text-content-tertiary pointer-events-none">
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
            to={
              node.pageType === "task-list"
                ? `/tasks/${node.slug}`
                : wikiPagePath(pathById.get(node.id) ?? [node.slug])
            }
            prefetch="intent"
            className="relative z-10 min-w-0 flex-1 truncate"
            onClick={() => {
              if (hasChildren) onToggle(node.id);
            }}
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
              pathById={pathById}
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
