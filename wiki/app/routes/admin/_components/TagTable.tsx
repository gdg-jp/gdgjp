import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import type { TagRow } from "./TagDialog";

export interface TagTableProps {
  tags: TagRow[];
  onEditTag: (tag: TagRow) => void;
}

export function TagTable({ tags, onEditTag }: TagTableProps) {
  const { t } = useTranslation();

  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface-raised">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border-default bg-surface-sunken">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.heading")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.col_label")}
              </th>
              <th className="px-4 py-3 text-right font-medium text-content-tertiary">
                {t("admin.tags.col_pages")}
              </th>
              <th className="px-4 py-3 text-right font-medium text-content-tertiary">
                {t("admin.tags.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {tags.map((tag) => (
              <tr key={tag.slug} className="group hover:bg-surface-hover">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-5 w-5 shrink-0 rounded"
                      style={{ backgroundColor: tag.color }} // design-token-policy: allow-dynamic-color
                      title={tag.color}
                    />
                    <span className="font-mono text-content-primary">{tag.slug}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-content-primary">{tag.labelJa}</div>
                  <div className="text-xs text-content-tertiary">{tag.labelEn}</div>
                </td>
                <td className="px-4 py-3 text-right text-content-tertiary tabular-nums">
                  {tag.pageCount}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => onEditTag(tag)}
                      className="rounded border border-border-strong px-3 py-1 text-xs font-medium text-content-secondary hover:bg-surface-hover"
                    >
                      {t("admin.tags.edit")}
                    </button>
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (!window.confirm(t("admin.tags.delete_confirm", { slug: tag.slug }))) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="deleteTag" />
                      <input type="hidden" name="slug" value={tag.slug} />
                      <button
                        type="submit"
                        className="rounded border border-feedback-danger-border px-3 py-1 text-xs font-medium text-feedback-danger-foreground hover:bg-feedback-danger-surface"
                      >
                        {t("admin.tags.delete")}
                      </button>
                    </Form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tags.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-content-disabled">
          {t("admin.tags.empty")}
        </p>
      )}
    </div>
  );
}
