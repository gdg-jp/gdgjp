import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import DropdownMenu, { type DropdownOption } from "~/components/tasks/DropdownMenu";
import * as schema from "~/db/schema";
import { hasRole, requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { generateSlug } from "~/lib/ingestion-pipeline.server";
import { insertPageOwner } from "~/lib/page-access.server";

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export const meta: MetaFunction = () => [{ title: "New Task List — GDGoC Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");
  const canLead = hasRole(user.role as string, "lead");
  return { canChangeVisibility: canLead };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");
  const db = getDb(env);

  const formData = await request.formData();
  const titleJa = (formData.get("titleJa") as string) ?? "";
  const titleEn = (formData.get("titleEn") as string) ?? "";
  const ALLOWED_VISIBILITY = ["public", "private_to_chapter", "private_to_lead"] as const;
  type Visibility = (typeof ALLOWED_VISIBILITY)[number];
  const rawVisibility = formData.get("visibility") as string;
  const canLead = hasRole(user.role as string, "lead");
  const visibility: Visibility =
    (ALLOWED_VISIBILITY as readonly string[]).includes(rawVisibility) &&
    (rawVisibility === "public" || canLead)
      ? (rawVisibility as Visibility)
      : "public";

  if (!titleJa && !titleEn) {
    return data({ error: "Title is required" }, { status: 400 });
  }

  // Generate unique slug
  const baseSlug = generateSlug(titleJa || titleEn, titleEn);
  let slug = baseSlug;
  const existing = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(eq(schema.pages.slug, slug))
    .get();
  if (existing) {
    slug = `${baseSlug}-${nanoid(6)}`;
  }

  const pageId = nanoid();

  // Create page and task_lists metadata atomically
  await db.batch([
    db.insert(schema.pages).values({
      id: pageId,
      titleJa,
      titleEn,
      slug,
      contentJa: "",
      contentEn: "",
      status: "published",
      pageType: "task-list",
      visibility,
      chapterId: user.chapterId ?? null,
      authorId: user.id,
      lastEditedBy: user.id,
    }),
    db.insert(schema.taskLists).values({
      pageId,
      nextTaskNumber: 1,
    }),
  ]);

  await insertPageOwner(db, pageId, user.id, user.email);

  return redirect(`/tasks/${slug}`);
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

export default function NewTaskList() {
  const { canChangeVisibility } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();
  const [activeLang, setActiveLang] = useState<"ja" | "en">("ja");
  const [visibility, setVisibility] = useState("public");

  const visibilityOptions: DropdownOption[] = [
    { value: "public", label: t("wiki.visibility_public") },
    { value: "private_to_chapter", label: t("wiki.visibility_chapter") },
    { value: "private_to_lead", label: t("wiki.visibility_lead") },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={14} />
        {t("editor.back_to_page")}
      </Link>

      <h1 className="mb-6 text-2xl font-bold">{t("tasks.new_title")}</h1>

      <Form method="post" className="space-y-6">
        {/* Language tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveLang("ja")}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeLang === "ja"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t("language.ja")}
          </button>
          <button
            type="button"
            onClick={() => setActiveLang("en")}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeLang === "en"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t("language.en")}
          </button>
        </div>

        {/* Title fields */}
        <div>
          <label htmlFor="titleJa" className={activeLang === "ja" ? "" : "hidden"}>
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {t("tasks.title_ja")}
            </span>
            <input
              id="titleJa"
              name="titleJa"
              type="text"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={t("tasks.title_ja_placeholder")}
            />
          </label>
          <label htmlFor="titleEn" className={activeLang === "en" ? "" : "hidden"}>
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {t("tasks.title_en")}
            </span>
            <input
              id="titleEn"
              name="titleEn"
              type="text"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={t("tasks.title_en_placeholder")}
            />
          </label>
        </div>

        {/* Visibility */}
        {canChangeVisibility && (
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {t("wiki.visibility")}
            </span>
            <input type="hidden" name="visibility" value={visibility} />
            <DropdownMenu
              value={visibility}
              options={visibilityOptions}
              onChange={setVisibility}
              variant="field"
            />
          </div>
        )}

        {actionData?.error && (
          <p role="alert" className="text-sm text-red-600">
            {actionData.error}
          </p>
        )}

        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {t("tasks.create")}
        </button>
      </Form>
    </div>
  );
}
