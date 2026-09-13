import { and, eq } from "drizzle-orm";

import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useLoaderData, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import TeamManager from "~/features/tasks/components/TeamManager";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

import { Icons } from "@gdgjp/ui";
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

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapters);
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

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapters);
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
    "w-full rounded-md border border-border px-3 py-2 text-sm focus:border-border-ring focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        to={`/tasks/${page.slug}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <Icons name="ArrowLeft" size={14} />
        {t("tasks.back_to_list")}
      </Link>

      <h1 className="mb-6 text-2xl font-bold">{t("tasks.settings")}</h1>

      {/* Title form */}
      <Form method="post" className="mb-8 space-y-4">
        <div>
          <label htmlFor="settings-titleJa" className="mb-1 block text-sm font-medium text-muted">
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
          <label htmlFor="settings-titleEn" className="mb-1 block text-sm font-medium text-muted">
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("tasks.save")}
        </button>
      </Form>

      {/* Team manager */}
      <TeamManager teams={teams} taskListId={page.id} onRefresh={() => revalidator.revalidate()} />
    </div>
  );
}
