import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChangesetOperation } from "../../../../shared/ingestion/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { Icons } from "@gdgjp/ui";
interface PageIndexEntry {
  id: string;
  titleJa: string;
  titleEn: string;
  slug: string;
  parentId: string | null;
}

interface OperationState {
  title: string;
  parentId: string | null;
}

interface PreviewNode {
  id: string;
  title: string;
  parentId: string | null;
  isNew: boolean;
  isUpdate: boolean;
  children: PreviewNode[];
}

interface PageStructurePreviewProps {
  pageIndex: PageIndexEntry[];
  operations: ChangesetOperation[];
  opStates: OperationState[];
}

// ---------------------------------------------------------------------------
// Build preview tree
// ---------------------------------------------------------------------------

function buildPreviewTree(
  pageIndex: PageIndexEntry[],
  operations: ChangesetOperation[],
  opStates: OperationState[],
): PreviewNode[] {
  // Start with existing pages
  const nodeMap = new Map<
    string,
    { id: string; title: string; parentId: string | null; isNew: boolean; isUpdate: boolean }
  >();

  for (const p of pageIndex) {
    nodeMap.set(p.id, {
      id: p.id,
      title: p.titleJa || p.titleEn || p.slug,
      parentId: p.parentId,
      isNew: false,
      isUpdate: false,
    });
  }

  // Apply UPDATE ops
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.type === "update" && op.pageId) {
      const existing = nodeMap.get(op.pageId);
      if (existing) {
        const newTitle = opStates[i]?.title || existing.title;
        nodeMap.set(op.pageId, { ...existing, title: newTitle, isUpdate: true });
      }
    }
  }

  // Apply CREATE ops — add virtual nodes
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.type === "create" && op.tempId) {
      nodeMap.set(op.tempId, {
        id: op.tempId,
        title: opStates[i]?.title || "(Untitled)",
        parentId: opStates[i]?.parentId ?? null,
        isNew: true,
        isUpdate: false,
      });
    }
  }

  // Build tree
  const treeMap = new Map<string, PreviewNode>();
  for (const [id, info] of nodeMap) {
    treeMap.set(id, { ...info, children: [] });
  }

  const roots: PreviewNode[] = [];
  for (const [, node] of treeMap) {
    if (node.parentId && treeMap.has(node.parentId)) {
      treeMap.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Tree node renderer
// ---------------------------------------------------------------------------

function PreviewTreeNode({ node, depth }: { node: PreviewNode; depth: number }) {
  const { t } = useTranslation();
  const indent = depth * 16;

  return (
    <div>
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${indent}px` }}>
        <span className="text-muted text-xs">{"└"}</span>
        {node.isNew ? (
          <>
            <span className="text-xs font-semibold text-success">+ {node.title}</span>
            <span // gdg-ui-allow: literal-color — app-specific-layout-or-token
              className="rounded-full bg-[var(--gdg-success-surface)] px-1.5 py-0.5 text-xs font-medium text-success"
            >
              {t("ingest.review.op_create")}
            </span>
          </>
        ) : node.isUpdate ? (
          <>
            <span className="text-xs italic text-link">~ {node.title}</span>
            <span className="rounded-full bg-selected px-1.5 py-0.5 text-xs font-medium text-link">
              {t("ingest.review.op_update")}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted">{node.title}</span>
        )}
      </div>
      {node.children.map((child) => (
        <PreviewTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PageStructurePreview({
  pageIndex,
  operations,
  opStates,
}: PageStructurePreviewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const roots = useMemo(
    () => buildPreviewTree(pageIndex, operations, opStates),
    [pageIndex, operations, opStates],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ui-pressable flex min-h-11 w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral/60"
      >
        <span className="text-sm font-medium text-foreground">
          {t("ingest.review.structure_preview")}
        </span>
        <Icons
          name="ChevronDown"
          // gdg-ui-allow: literal-color — app-specific-layout-or-token
          className={`size-4 text-muted transition-transform duration-200 ease-[var(--motion-ease-in-out)] ${open ? "rotate-180" : "rotate-0"}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="border-t border-border px-4 py-3">
          {roots.length === 0 ? (
            <p className="text-xs text-muted">{t("ingest.review.parent_none")}</p>
          ) : (
            <div className="font-mono">
              {roots.map((node) => (
                <PreviewTreeNode key={node.id} node={node} depth={0} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
