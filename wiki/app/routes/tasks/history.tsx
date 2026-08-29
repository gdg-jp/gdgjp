import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import { timeAgo } from "~/lib/time";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data
      ? `History — ${data.page.titleJa || data.page.titleEn} — GDG Japan Wiki`
      : "Task History",
  },
];

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { slug } = params;
  if (!slug) throw new Response("Not found", { status: 404 });

  const page = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      pageType: schema.pages.pageType,
      visibility: schema.pages.visibility,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
      createdAt: schema.pages.createdAt,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.pageType, "task-list")))
    .get();

  if (!page) throw new Response("Not found", { status: 404 });

  if (!(await getEffectivePagePermissions(db, page, user, identity.chapters)).canView) {
    throw new Response("Forbidden", { status: 403 });
  }

  const taskRows = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      status: schema.tasks.status,
      createdAt: schema.tasks.createdAt,
      creatorName: schema.user.name,
    })
    .from(schema.tasks)
    .leftJoin(schema.user, eq(schema.tasks.createdBy, schema.user.id))
    .where(eq(schema.tasks.taskListId, page.id))
    .orderBy(desc(schema.tasks.createdAt))
    .all();

  return { page, tasks: taskRows };
}

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-surface-hover text-content-secondary",
  in_progress: "bg-feedback-info-surface text-action-primary-hover",
  done: "bg-task-done-surface text-feedback-success-foreground",
  cancelled: "bg-task-cancelled-surface text-feedback-danger-foreground",
  duplicated: "bg-task-duplicated-surface text-task-duplicated-foreground",
};

export default function TaskHistoryPage() {
  const { page, tasks } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();

  const title =
    i18n.language === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;

  function statusLabel(status: string) {
    const key = `tasks.status_${status}` as const;
    return t(key as Parameters<typeof t>[0]);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        to={`/tasks/${page.slug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-content-tertiary hover:text-content-primary"
      >
        <ArrowLeft size={14} />
        {title}
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-content-primary">{t("tasks.history")}</h1>

      {tasks.length === 0 ? (
        <p className="text-sm text-content-disabled">{t("tasks.history_empty")}</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3 shadow-sm"
            >
              <span className="shrink-0 text-sm font-mono text-content-disabled">
                #{task.number}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-content-primary">
                {task.title}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[task.status] ?? "bg-surface-hover text-content-secondary"}`}
              >
                {statusLabel(task.status)}
              </span>
              <span className="shrink-0 text-xs text-content-disabled">
                {task.creatorName ? `${task.creatorName} · ` : ""}
                {task.createdAt ? timeAgo(new Date(task.createdAt as unknown as string), t) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
