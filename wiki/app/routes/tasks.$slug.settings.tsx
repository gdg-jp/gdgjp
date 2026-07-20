import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useLoaderData, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import TeamManager from "~/components/tasks/TeamManager";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";

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
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { slug } = params;
  if (!slug) throw new Response("Not found", { status: 404 });

  const page = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.pageType, "task-list")))
    .get();

  if (!page) throw new Response("Not found", { status: 404 });

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapterIds);
  if (!permissions.canEdit) throw new Response("Forbidden", { status: 403 });

  const teams = await db
    .select()
    .from(schema.taskListTeams)
    .where(eq(schema.taskListTeams.taskListId, page.id))
    .orderBy(schema.taskListTeams.sortOrder)
    .all();

  return { page, teams };
}

// ---------------------------------------------------------------------------
// Action — update title. General access is managed exclusively by ShareDialog.
// ---------------------------------------------------------------------------

export async function action({ request, params, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { slug } = params;
  if (!slug) throw new Response("Not found", { status: 404 });

  const page = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.pageType, "task-list")))
    .get();

  if (!page) throw new Response("Not found", { status: 404 });

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapterIds);
  if (!permissions.canEdit) throw new Response("Forbidden", { status: 403 });

  const formData = await request.formData();
  const titleJa = (formData.get("titleJa") as string) ?? page.titleJa;
  const titleEn = (formData.get("titleEn") as string) ?? page.titleEn;

  await db
    .update(schema.pages)
    .set({ titleJa, titleEn, updatedAt: new Date() })
    .where(eq(schema.pages.id, page.id));

  return redirect(`/tasks/${slug}`);
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

export default function TaskListSettings() {
  const { page, teams } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const revalidator = useRevalidator();

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

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

      {/* Title form */}
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
