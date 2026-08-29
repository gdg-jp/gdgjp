import { desc, eq } from "drizzle-orm";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireAdmin } from "~/features/auth/utils.server";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const db = getDb(env);
  const tags = await db.select().from(schema.tags).orderBy(desc(schema.tags.pageCount)).all();
  return { tags };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const db = getDb(env);

  if (intent === "createTag") {
    const slug = (form.get("slug") as string).trim().toLowerCase();
    const labelJa = (form.get("labelJa") as string).trim();
    const labelEn = (form.get("labelEn") as string).trim();
    const color = (form.get("color") as string).trim();

    if (!slug || !labelJa || !labelEn || !color) return { error: "All fields are required." };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      return { error: "Slug must contain only lowercase letters, numbers, and hyphens." };
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Invalid color format." };

    const existing = await db
      .select({ slug: schema.tags.slug })
      .from(schema.tags)
      .where(eq(schema.tags.slug, slug))
      .get();
    if (existing) return { error: `A tag with slug "${slug}" already exists.` };

    await db.insert(schema.tags).values({ slug, labelJa, labelEn, color });
    return { ok: true, created: slug };
  }

  if (intent === "updateTag") {
    const slug = form.get("slug") as string;
    const labelJa = (form.get("labelJa") as string).trim();
    const labelEn = (form.get("labelEn") as string).trim();
    const color = (form.get("color") as string).trim();

    if (!slug || !labelJa || !labelEn || !color) return { error: "All fields are required." };
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Invalid color format." };

    await db.update(schema.tags).set({ labelJa, labelEn, color }).where(eq(schema.tags.slug, slug));
    return { ok: true, updated: slug };
  }

  if (intent === "deleteTag") {
    const slug = form.get("slug") as string;
    if (!slug) return {};
    await db.delete(schema.pageTags).where(eq(schema.pageTags.tagSlug, slug));
    await db.delete(schema.tags).where(eq(schema.tags.slug, slug));
    return { ok: true, deleted: true };
  }

  return {};
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export default function AdminTags() {
  const { tags } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  const flashOk =
    actionData && "ok" in actionData && actionData.ok
      ? "created" in actionData
        ? t("admin.tags.created", { slug: actionData.created })
        : "updated" in actionData
          ? t("admin.tags.updated", { slug: actionData.updated })
          : "deleted" in actionData
            ? t("admin.tags.deleted")
            : null
      : null;

  const flashError = actionData && "error" in actionData ? (actionData.error as string) : null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-content-primary">{t("admin.tags.heading")}</h1>

      {flashOk && (
        <div className="mb-4 rounded-md bg-feedback-success-surface px-4 py-3 text-sm text-feedback-success-foreground">
          {flashOk}
        </div>
      )}
      {flashError && (
        <div className="mb-4 rounded-md bg-feedback-danger-surface px-4 py-3 text-sm text-feedback-danger-foreground">
          {flashError}
        </div>
      )}

      {/* Create form */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-content-primary">
          {t("admin.tags.new_tag")}
        </h2>
        <div className="rounded-lg border border-border-default bg-surface-raised p-6">
          <Form method="post">
            <input type="hidden" name="intent" value="createTag" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="create-slug"
                  className="mb-1 block text-sm font-medium text-content-secondary"
                >
                  {t("admin.tags.form.slug")}
                </label>
                <input
                  id="create-slug"
                  type="text"
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="my-tag"
                  className="w-full rounded-md border border-border-strong px-3 py-2 text-sm focus:border-border-focus focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="create-color"
                  className="mb-1 block text-sm font-medium text-content-secondary"
                >
                  {t("admin.tags.form.color")}
                </label>
                <input
                  id="create-color"
                  type="color"
                  name="color"
                  defaultValue="#3b82f6" // design-token-policy: allow-dynamic-color
                  className="h-10 w-full cursor-pointer rounded-md border border-border-strong"
                />
              </div>
              <div>
                <label
                  htmlFor="create-label-ja"
                  className="mb-1 block text-sm font-medium text-content-secondary"
                >
                  {t("admin.tags.form.label_ja")}
                </label>
                <input
                  id="create-label-ja"
                  type="text"
                  name="labelJa"
                  required
                  className="w-full rounded-md border border-border-strong px-3 py-2 text-sm focus:border-border-focus focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="create-label-en"
                  className="mb-1 block text-sm font-medium text-content-secondary"
                >
                  {t("admin.tags.form.label_en")}
                </label>
                <input
                  id="create-label-en"
                  type="text"
                  name="labelEn"
                  required
                  className="w-full rounded-md border border-border-strong px-3 py-2 text-sm focus:border-border-focus focus:outline-none"
                />
              </div>
              <div className="col-span-2 flex justify-end">
                <button
                  type="submit"
                  className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover"
                >
                  {t("admin.tags.form.submit")}
                </button>
              </div>
            </div>
          </Form>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-default bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="border-b border-border-default bg-surface-sunken">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.col_color")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.col_slug")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.col_label_ja")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.col_label_en")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.col_pages")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-content-tertiary">
                {t("admin.tags.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {tags.map((tag) =>
              editingSlug === tag.slug ? (
                <tr key={tag.slug} className="bg-feedback-info-surface ">
                  {/* Color cell — color picker input associated with edit-form */}
                  <td className="px-4 py-3">
                    <input
                      type="color"
                      name="color"
                      form={`edit-form-${tag.slug}`}
                      defaultValue={tag.color}
                      className="h-8 w-10 cursor-pointer rounded border border-border-strong"
                    />
                  </td>
                  {/* Slug cell — read-only text + hidden input */}
                  <td className="px-4 py-3 font-mono text-content-secondary">
                    {tag.slug}
                    <input
                      type="hidden"
                      name="slug"
                      form={`edit-form-${tag.slug}`}
                      value={tag.slug}
                    />
                  </td>
                  {/* Label JA */}
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      name="labelJa"
                      form={`edit-form-${tag.slug}`}
                      defaultValue={tag.labelJa}
                      required
                      className="w-full rounded border border-border-strong px-2 py-1 text-sm focus:border-border-focus focus:outline-none"
                    />
                  </td>
                  {/* Label EN */}
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      name="labelEn"
                      form={`edit-form-${tag.slug}`}
                      defaultValue={tag.labelEn}
                      required
                      className="w-full rounded border border-border-strong px-2 py-1 text-sm focus:border-border-focus focus:outline-none"
                    />
                  </td>
                  {/* Page count — read-only */}
                  <td className="px-4 py-3 text-content-tertiary">{tag.pageCount}</td>
                  {/* Actions cell — contains the actual form */}
                  <td className="px-4 py-3">
                    <Form
                      method="post"
                      id={`edit-form-${tag.slug}`}
                      onSubmit={() => setEditingSlug(null)}
                      className="flex gap-2"
                    >
                      <input type="hidden" name="intent" value="updateTag" />
                      <button
                        type="submit"
                        className="rounded bg-action-primary px-3 py-1 text-xs font-medium text-action-primary-foreground hover:bg-action-primary-hover"
                      >
                        {t("admin.tags.form.update")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSlug(null)}
                        className="rounded border border-border-strong px-3 py-1 text-xs font-medium text-content-secondary hover:bg-surface-hover"
                      >
                        {t("cancel")}
                      </button>
                    </Form>
                  </td>
                </tr>
              ) : (
                <tr key={tag.slug} className="hover:bg-surface-hover">
                  <td className="px-4 py-3">
                    <div
                      className="h-5 w-5 rounded"
                      style={{ backgroundColor: tag.color }}
                      title={tag.color}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-content-secondary">{tag.slug}</td>
                  <td className="px-4 py-3 text-content-primary">{tag.labelJa}</td>
                  <td className="px-4 py-3 text-content-secondary">{tag.labelEn}</td>
                  <td className="px-4 py-3 text-content-tertiary">{tag.pageCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingSlug(tag.slug)}
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
              ),
            )}
          </tbody>
        </table>

        {tags.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-content-disabled">
            {t("admin.tags.empty")}
          </p>
        )}
      </div>
    </div>
  );
}
