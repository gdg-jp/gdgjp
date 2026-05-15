import { desc, eq } from "drizzle-orm";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireRole(request, env, "admin");
  const db = getDb(env);
  const tags = await db.select().from(schema.tags).orderBy(desc(schema.tags.pageCount)).all();
  return { tags };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  await requireRole(request, env, "admin");
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
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t("admin.tags.heading")}</h1>

      {flashOk && (
        <div className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          {flashOk}
        </div>
      )}
      {flashError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{flashError}</div>
      )}

      {/* Create form */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("admin.tags.new_tag")}</h2>
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <Form method="post">
            <input type="hidden" name="intent" value="createTag" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="create-slug"
                  className="mb-1 block text-sm font-medium text-gray-700"
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
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="create-color"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t("admin.tags.form.color")}
                </label>
                <input
                  id="create-color"
                  type="color"
                  name="color"
                  defaultValue="#3b82f6"
                  className="h-10 w-full cursor-pointer rounded-md border border-gray-300"
                />
              </div>
              <div>
                <label
                  htmlFor="create-label-ja"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t("admin.tags.form.label_ja")}
                </label>
                <input
                  id="create-label-ja"
                  type="text"
                  name="labelJa"
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="create-label-en"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t("admin.tags.form.label_en")}
                </label>
                <input
                  id="create-label-en"
                  type="text"
                  name="labelEn"
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="col-span-2 flex justify-end">
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {t("admin.tags.form.submit")}
                </button>
              </div>
            </div>
          </Form>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.tags.col_color")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.tags.col_slug")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.tags.col_label_ja")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.tags.col_label_en")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.tags.col_pages")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.tags.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tags.map((tag) =>
              editingSlug === tag.slug ? (
                <tr key={tag.slug} className="bg-blue-50 dark:bg-blue-950/40">
                  {/* Color cell — color picker input associated with edit-form */}
                  <td className="px-4 py-3">
                    <input
                      type="color"
                      name="color"
                      form={`edit-form-${tag.slug}`}
                      defaultValue={tag.color}
                      className="h-8 w-10 cursor-pointer rounded border border-gray-300"
                    />
                  </td>
                  {/* Slug cell — read-only text + hidden input */}
                  <td className="px-4 py-3 font-mono text-gray-700">
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
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
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
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  {/* Page count — read-only */}
                  <td className="px-4 py-3 text-gray-500">{tag.pageCount}</td>
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
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        {t("admin.tags.form.update")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSlug(null)}
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        {t("cancel")}
                      </button>
                    </Form>
                  </td>
                </tr>
              ) : (
                <tr key={tag.slug} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div
                      className="h-5 w-5 rounded"
                      style={{ backgroundColor: tag.color }}
                      title={tag.color}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-700">{tag.slug}</td>
                  <td className="px-4 py-3 text-gray-900">{tag.labelJa}</td>
                  <td className="px-4 py-3 text-gray-600">{tag.labelEn}</td>
                  <td className="px-4 py-3 text-gray-500">{tag.pageCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingSlug(tag.slug)}
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
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
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
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
          <p className="px-4 py-8 text-center text-sm text-gray-400">{t("admin.tags.empty")}</p>
        )}
      </div>
    </div>
  );
}
