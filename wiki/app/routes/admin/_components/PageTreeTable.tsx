import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import type { AdminPageNode } from "./admin-page-tree";

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls =
    status === "published"
      ? "bg-feedback-success-surface text-feedback-success-foreground"
      : status === "archived"
        ? "bg-surface-hover text-content-tertiary"
        : "bg-surface-hover text-content-tertiary";
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
    <span className="inline-flex items-center rounded-full bg-feedback-info-surface px-2 py-0.5 text-xs font-medium text-feedback-info-foreground">
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
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface-raised">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border-default bg-surface-sunken">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.pages.col_title")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.pages.col_status")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.pages.col_author")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.pages.col_updated")}
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {visiblePages.map((p) => {
              const isCollapsed = collapsedIds.has(p.id);
              return (
                <tr key={p.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-3">
                    <div
                      className="flex items-start gap-1.5"
                      style={{ paddingLeft: `${p.depth * 16}px` }}
                    >
                      {p.childCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleCollapse(p.id)}
                          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-content-tertiary hover:bg-surface-hover hover:text-content-primary"
                          aria-expanded={!isCollapsed}
                          aria-label={
                            isCollapsed ? t("admin.pages.expand") : t("admin.pages.collapse")
                          }
                        >
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                      ) : (
                        <span className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
                      )}
                      <Link to={p.wikiPath} className="group min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-content-primary group-hover:text-action-primary">
                            {p.titleJa}
                          </span>
                          {p.childCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-content-tertiary">
                              {t("admin.pages.child_count", { count: p.childCount })}
                            </span>
                          )}
                        </div>
                        {p.titleEn && <p className="text-xs text-content-disabled">{p.titleEn}</p>}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <StatusBadge status={p.status} />
                      <VisibilityBadge visibility={p.visibility} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-content-secondary whitespace-nowrap">
                    {p.authorName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-content-tertiary whitespace-nowrap">
                    {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {p.status !== "archived" ? (
                        <>
                          <Link
                            to={`/wiki/${p.slug}/edit`}
                            className="rounded px-2 py-1 text-xs text-action-primary hover:bg-surface-selected"
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
                              className="rounded px-2 py-1 text-xs text-content-secondary hover:bg-surface-hover"
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
                              className="rounded px-2 py-1 text-xs text-action-primary hover:bg-surface-selected"
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
                              className="rounded px-2 py-1 text-xs text-feedback-danger-foreground hover:bg-feedback-danger-surface"
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
        <p className="px-4 py-8 text-center text-sm text-content-disabled">
          {t("admin.pages.empty")}
        </p>
      )}
    </div>
  );
}
