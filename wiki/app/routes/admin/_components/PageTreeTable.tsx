import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import type { AdminPageNode } from "./admin-page-tree";

import { Icons } from "@gdgjp/ui";
function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls =
    status === "published"
      ? "bg-[var(--gdg-success-surface)] text-success"
      : status === "archived"
        ? "bg-neutral text-muted"
        : "bg-neutral text-muted";
  const label = status === "archived" ? t("admin.pages.status_archived") : status;
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        cls,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === "public") return null;
  const label = visibility === "unlisted" ? "unlisted" : "restricted";
  return (
    <span className="inline-flex items-center rounded-full bg-selected px-2 py-0.5 text-xs font-medium text-link">
      {label}
    </span>
  );
}

export function PageTreeTable({ pages }: { pages: AdminPageNode[] }) {
  const { t } = useTranslation();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const visiblePages: AdminPageNode[] = [];
  let collapsedDepth: number | null = null;

  for (const page of pages) {
    if (collapsedDepth !== null) {
      if (page.depth > collapsedDepth) {
        continue;
      }
      collapsedDepth = null;
    }

    visiblePages.push(page);

    if (collapsedIds.has(page.id)) {
      collapsedDepth = page.depth;
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-neutral">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted">
                {t("admin.pages.col_title")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted">
                {t("admin.pages.col_status")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted">
                {t("admin.pages.col_author")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted">
                {t("admin.pages.col_updated")}
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-border">
            {visiblePages.map((p) => {
              const isCollapsed = collapsedIds.has(p.id);
              return (
                <tr key={p.id} className="hover:bg-neutral">
                  <td className="px-4 py-3">
                    <div
                      className="flex items-start gap-1.5"
                      style={{ paddingLeft: `${p.depth * 16}px` }}
                    >
                      {p.childCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleCollapse(p.id)}
                          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted hover:bg-neutral hover:text-foreground"
                          aria-expanded={!isCollapsed}
                          aria-label={
                            isCollapsed ? t("admin.pages.expand") : t("admin.pages.collapse")
                          }
                        >
                          {isCollapsed ? (
                            <Icons name="ChevronRight" size={14} />
                          ) : (
                            <Icons name="ChevronDown" size={14} />
                          )}
                        </button>
                      ) : (
                        <span className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
                      )}
                      <Link to={p.wikiPath} className="group min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground group-hover:text-link">
                            {p.titleJa}
                          </span>
                          {p.childCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-neutral px-2 py-0.5 text-xs font-medium text-muted">
                              {t("admin.pages.child_count", { count: p.childCount })}
                            </span>
                          )}
                        </div>
                        {p.titleEn && <p className="text-xs text-muted/70">{p.titleEn}</p>}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <StatusBadge status={p.status} />
                      <VisibilityBadge visibility={p.visibility} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{p.authorName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {p.status !== "archived" ? (
                        <>
                          <Link
                            to={`/wiki/${p.slug}/edit`}
                            className="rounded px-2 py-1 text-xs text-link hover:bg-selected"
                          >
                            {t("admin.pages.edit")}
                          </Link>
                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (
                                !window.confirm(
                                  t("admin.pages.archive_confirm", { title: p.titleJa }),
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="intent" value="archivePage" />
                            <input type="hidden" name="pageId" value={p.id} />
                            <button
                              type="submit"
                              className="rounded px-2 py-1 text-xs text-muted hover:bg-neutral"
                            >
                              {t("admin.pages.archive")}
                            </button>
                          </Form>
                        </>
                      ) : (
                        <>
                          <Form method="post">
                            <input type="hidden" name="intent" value="restorePage" />
                            <input type="hidden" name="pageId" value={p.id} />
                            <button
                              type="submit"
                              className="rounded px-2 py-1 text-xs text-link hover:bg-selected"
                            >
                              {t("admin.pages.restore")}
                            </button>
                          </Form>
                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (
                                !window.confirm(
                                  t("admin.pages.delete_archived_confirm", { title: p.titleJa }),
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="intent" value="deletePage" />
                            <input type="hidden" name="pageId" value={p.id} />
                            <button
                              type="submit"
                              // gdg-ui-allow: literal-color — app-specific-layout-or-token
                              className="rounded px-2 py-1 text-xs text-danger hover:bg-[var(--gdg-danger-surface)]"
                            >
                              {t("admin.pages.delete")}
                            </button>
                          </Form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted/70">{t("admin.pages.empty")}</p>
      )}
    </div>
  );
}
