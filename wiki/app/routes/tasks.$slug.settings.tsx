import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useLoaderData, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import DropdownMenu, { type DropdownOption } from "~/components/tasks/DropdownMenu";
import TeamManager from "~/components/tasks/TeamManager";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { canUserChangeVisibility, canUserSeePageAsync } from "~/lib/page-visibility.server";

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export const meta: MetaFunction = () => [{ title: "Task List Settings — GDG Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const { slug } = params;
  if (!slug) throw new Response("Not found", { status: 404 });

  const page = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.pageType, "task-list")))
    .get();

  if (!page) throw new Response("Not found", { status: 404 });

  if (!(await canUserSeePageAsync(db, user, page))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const canManage = user.isAdmin || user.id === page.authorId;

  if (!canManage) throw new Response("Forbidden", { status: 403 });

  const teams = await db
    .select()
    .from(schema.taskListTeams)
    .where(eq(schema.taskListTeams.taskListId, page.id))
    .orderBy(schema.taskListTeams.sortOrder)
    .all();

  return { page, teams, canChangeVisibility: canUserChangeVisibility(user, page) };
}

// ---------------------------------------------------------------------------
// Action — update title/visibility
// ---------------------------------------------------------------------------

export async function action({ request, params, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const { slug } = params;
  if (!slug) throw new Response("Not found", { status: 404 });

  const page = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.pageType, "task-list")))
    .get();

  if (!page) throw new Response("Not found", { status: 404 });

  const canManage = user.isAdmin || user.id === page.authorId;

  if (!canManage) throw new Response("Forbidden", { status: 403 });

  const formData = await request.formData();
  const titleJa = (formData.get("titleJa") as string) ?? page.titleJa;
  const titleEn = (formData.get("titleEn") as string) ?? page.titleEn;
  const visibility = (formData.get("visibility") as string) ?? page.visibility;

  await db
    .update(schema.pages)
    .set({ titleJa, titleEn, visibility, updatedAt: new Date() })
    .where(eq(schema.pages.id, page.id));

  return redirect(`/tasks/${slug}`);
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

export default function TaskListSettings() {
  const { page, teams, canChangeVisibility } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const [visibility, setVisibility] = useState(page.visibility);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  const visibilityOptions: DropdownOption[] = [
    { value: "restricted", label: t("wiki.visibility_restricted") },
    { value: "public", label: t("wiki.visibility_public") },
    { value: "private_to_chapter", label: t("wiki.visibility_chapter") },
    { value: "private_to_lead", label: t("wiki.visibility_lead") },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        to={`/tasks/${page.slug}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={14} />
        {t("tasks.back_to_list")}
      </Link>

      <h1 className="mb-6 text-2xl font-bold">{t("tasks.settings")}</h1>

      {/* Title & visibility form */}
      <Form method="post" className="mb-8 space-y-4">
        <div>
          <label
            htmlFor="settings-titleJa"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            {t("tasks.title_ja")}
          </label>
          <input
            id="settings-titleJa"
            name="titleJa"
            type="text"
            className={inputClass}
            defaultValue={page.titleJa}
          />
        </div>

        <div>
          <label
            htmlFor="settings-titleEn"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            {t("tasks.title_en")}
          </label>
          <input
            id="settings-titleEn"
            name="titleEn"
            type="text"
            className={inputClass}
            defaultValue={page.titleEn}
          />
        </div>

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

        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t("tasks.save")}
        </button>
      </Form>

      {/* Team manager */}
      <TeamManager teams={teams} taskListId={page.id} onRefresh={() => revalidator.revalidate()} />
    </div>
  );
}
