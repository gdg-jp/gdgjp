import { desc, eq } from "drizzle-orm";
import { Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { TableSkeleton } from "~/components/Skeleton";
import * as schema from "~/db/schema";
import { requireAdmin } from "~/features/auth/utils.server";
import { getDb } from "~/lib/db.server";
import { TagDialog } from "./_components/TagDialog";
import type { TagRow } from "./_components/TagDialog";
import { TagTable } from "./_components/TagTable";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const db = getDb(env);
  const tags = db.select().from(schema.tags).orderBy(desc(schema.tags.pageCount)).all();
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
    const slug = (form.get("slug") as string | null)?.trim().toLowerCase() ?? "";
    const labelJa = (form.get("labelJa") as string | null)?.trim() ?? "";
    const labelEn = (form.get("labelEn") as string | null)?.trim() ?? "";
    const color = (form.get("color") as string | null)?.trim() ?? "";

    if (!slug || !labelJa || !labelEn || !color) {
      return { errorKey: "admin.tags.error_required" as const };
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return { errorKey: "admin.tags.error_slug_invalid" as const };
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return { errorKey: "admin.tags.error_color_invalid" as const };
    }

    const existing = await db
      .select({ slug: schema.tags.slug })
      .from(schema.tags)
      .where(eq(schema.tags.slug, slug))
      .get();
    if (existing) {
      return { errorKey: "admin.tags.error_slug_taken" as const, errorParams: { slug } };
    }

    await db.insert(schema.tags).values({ slug, labelJa, labelEn, color });
    return { ok: true, created: slug };
  }

  if (intent === "updateTag") {
    const slug = (form.get("slug") as string | null)?.trim() ?? "";
    const labelJa = (form.get("labelJa") as string | null)?.trim() ?? "";
    const labelEn = (form.get("labelEn") as string | null)?.trim() ?? "";
    const color = (form.get("color") as string | null)?.trim() ?? "";

    if (!slug || !labelJa || !labelEn || !color) {
      return { errorKey: "admin.tags.error_required" as const };
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return { errorKey: "admin.tags.error_color_invalid" as const };
    }

    await db.update(schema.tags).set({ labelJa, labelEn, color }).where(eq(schema.tags.slug, slug));
    return { ok: true, updated: slug };
  }

  if (intent === "deleteTag") {
    const slug = (form.get("slug") as string | null)?.trim() ?? "";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedTag, setSelectedTag] = useState<TagRow | null>(null);

  const handleCreate = () => {
    setDialogMode("create");
    setSelectedTag(null);
    setDialogOpen(true);
  };

  const handleEdit = (tag: TagRow) => {
    setDialogMode("edit");
    setSelectedTag(tag);
    setDialogOpen(true);
  };

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

  const flashError =
    actionData && "errorKey" in actionData && actionData.errorKey
      ? t(actionData.errorKey, "errorParams" in actionData ? actionData.errorParams : undefined)
      : null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-content-primary">{t("admin.tags.heading")}</h1>
        <button
          type="button"
          onClick={handleCreate}
          className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover"
        >
          {t("admin.tags.new_tag")}
        </button>
      </div>

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

      <Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
        <Await
          resolve={tags}
          errorElement={
            <p className="text-sm text-feedback-danger-foreground">Failed to load tags.</p>
          }
        >
          {(resolvedTags) => <TagTable tags={resolvedTags} onEditTag={handleEdit} />}
        </Await>
      </Suspense>

      <TagDialog
        mode={dialogMode}
        tag={selectedTag}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
