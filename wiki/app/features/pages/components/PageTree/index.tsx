import { ChartPie, ListTodo, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { type PageNode, buildSlugPathById, getAncestorIdsForSlug } from "~/features/pages/tree";
import { findNodeIdBySlug } from "./build-tree";
import { DraggablePageTree } from "./dnd";
import { TreeNode } from "./row";

export type { PageNode };

interface PageTreeProps {
  pages: PageNode[];
  currentSlug?: string;
  isCollapsed?: boolean;
  canReorder?: boolean;
  canCreate?: boolean;
  onImportZip?: () => void;
}

// ---------------------------------------------------------------------------
// PageTree — public component. Tree math: `build-tree.ts`; DnD: `dnd.tsx`;
// row rendering: `row.tsx`.
// ---------------------------------------------------------------------------
export default function PageTree({
  pages,
  currentSlug,
  isCollapsed = false,
  canReorder = false,
  canCreate = true,
  onImportZip,
}: PageTreeProps) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef(pages);
  const [expandedIds, setExpandedIds] = useState(() => getAncestorIdsForSlug(pages, currentSlug));
  const pathById = useMemo(() => buildSlugPathById(pages), [pages]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    setExpandedIds((previous) => {
      const ancestors = getAncestorIdsForSlug(pagesRef.current, currentSlug);
      if (!currentSlug) return ancestors;

      // Preserve expand/collapse of the destination itself when the same click both
      // toggled the row and navigated (title click on a folder).
      const next = new Set(ancestors);
      const currentId = findNodeIdBySlug(pagesRef.current, currentSlug);
      if (currentId && previous.has(currentId)) next.add(currentId);
      return next;
    });
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
          pathById={pathById}
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
              pathById={pathById}
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
              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  onImportZip?.();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-content-secondary hover:bg-surface-canvas"
              >
                <span>⇪</span>
                <span>{t("pageTree.importZip")}</span>
              </button>
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
