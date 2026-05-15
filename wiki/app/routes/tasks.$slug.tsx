import { and, eq, inArray } from "drizzle-orm";
import {
  Archive,
  CalendarDays,
  Check,
  History,
  LayoutList,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Share2,
  Star,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import ShareDialog from "~/components/ShareDialog";
import Tooltip from "~/components/Tooltip";
import DropdownMenu, { type DropdownOption } from "~/components/tasks/DropdownMenu";
import TaskRemainingView from "~/components/tasks/TaskRemainingView";
import TaskTableView from "~/components/tasks/TaskTableView";
import TaskTimelineView from "~/components/tasks/TaskTimelineView";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { canUserManageAccess } from "~/lib/page-access.server";
import { canUserChangeVisibility, canUserSeePageAsync } from "~/lib/page-visibility.server";

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.page.titleJa || data.page.titleEn} — GDGoC Japan Wiki` : "Tasks" },
];

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

  const taskListMeta = await db
    .select()
    .from(schema.taskLists)
    .where(eq(schema.taskLists.pageId, page.id))
    .get();

  if (!taskListMeta) throw new Response("Not found", { status: 404 });

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.taskListId, page.id))
    .orderBy(schema.tasks.sortOrder)
    .all();

  const teams = await db
    .select()
    .from(schema.taskListTeams)
    .where(eq(schema.taskListTeams.taskListId, page.id))
    .orderBy(schema.taskListTeams.sortOrder)
    .all();

  // Get dependencies for all tasks in this list
  const taskIds = tasks.map((t) => t.id);
  const deps =
    taskIds.length > 0
      ? await db
          .select()
          .from(schema.taskDependencies)
          .where(inArray(schema.taskDependencies.taskId, taskIds))
          .all()
      : [];

  // Build dependency map
  const depMap = new Map<string, string[]>();
  for (const d of deps) {
    const list = depMap.get(d.taskId) || [];
    list.push(d.dependsOnTaskId);
    depMap.set(d.taskId, list);
  }

  // Assignee list: pre-SSO this scoped to the task list's chapter members.
  // Wiki no longer stores per-user chapter, so all users are candidates;
  // re-scope once chapter membership is read from IdP claims.
  const members = await db
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .all();

  const canManage = user.isAdmin || user.id === page.authorId;

  const fav = await db
    .select()
    .from(schema.pageFavorites)
    .where(and(eq(schema.pageFavorites.userId, user.id), eq(schema.pageFavorites.pageId, page.id)))
    .get();

  const canManagePageAccess = await canUserManageAccess(db, page.id, user, page.authorId);

  return {
    page,
    tasks: tasks.map((t) => ({
      ...t,
      dependencies: depMap.get(t.id) || [],
    })),
    teams,
    members,
    taskListId: page.id,
    canManage,
    canChangeVisibility: canUserChangeVisibility(user, page),
    canManageAccess: canManagePageAccess,
    userId: user.id,
    nextTaskNumber: taskListMeta.nextTaskNumber,
    isStarred: !!fav,
    canArchive: user.isAdmin || user.id === page.authorId,
  };
}

// ---------------------------------------------------------------------------
// Action
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

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "toggleFavorite") {
    if (!(await canUserSeePageAsync(db, user, page)))
      throw new Response("Forbidden", { status: 403 });

    const existing = await db
      .select()
      .from(schema.pageFavorites)
      .where(
        and(eq(schema.pageFavorites.userId, user.id), eq(schema.pageFavorites.pageId, page.id)),
      )
      .get();

    if (existing) {
      await db
        .delete(schema.pageFavorites)
        .where(
          and(eq(schema.pageFavorites.userId, user.id), eq(schema.pageFavorites.pageId, page.id)),
        );
      return { ok: true, starred: false };
    }
    await db.insert(schema.pageFavorites).values({ userId: user.id, pageId: page.id });
    return { ok: true, starred: true };
  }

  if (intent === "archivePage") {
    const canArchive = user.isAdmin || user.id === page.authorId;
    if (!canArchive) throw new Response("Forbidden", { status: 403 });
    await db
      .update(schema.pages)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(schema.pages.id, page.id));
    return redirect("/");
  }

  const canManage = user.isAdmin || user.id === page.authorId;

  if (!canManage) throw new Response("Forbidden", { status: 403 });

  if (intent === "updateSettings") {
    const titleJa = (formData.get("titleJa") as string) ?? page.titleJa;
    const titleEn = (formData.get("titleEn") as string) ?? page.titleEn;
    const visibility = (formData.get("visibility") as string) ?? page.visibility;

    await db
      .update(schema.pages)
      .set({ titleJa, titleEn, visibility, updatedAt: new Date() })
      .where(eq(schema.pages.id, page.id));

    return { ok: true };
  }

  if (intent === "setVisibility") {
    if (!canUserChangeVisibility(user, page)) throw new Response("Forbidden", { status: 403 });
    const visibility = (formData.get("visibility") as string) ?? page.visibility;

    await db
      .update(schema.pages)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(schema.pages.id, page.id));

    return { ok: true };
  }

  throw new Response("Bad request", { status: 400 });
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

type ViewTab = "table" | "timeline" | "remaining";

async function ensureOkResponse(response: Response): Promise<void> {
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
}

export default function TaskListView() {
  const {
    page,
    tasks,
    teams,
    members,
    taskListId,
    canManage,
    canChangeVisibility,
    canManageAccess,
    nextTaskNumber,
    isStarred,
    canArchive,
  } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const revalidator = useRevalidator();
  const settingsFetcher = useFetcher<{ ok: boolean }>();
  const visibilityFetcher = useFetcher<{ ok: boolean }>();
  const favFetcher = useFetcher<{ ok: boolean; starred: boolean }>();
  const archiveFetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<ViewTab>("table");

  // Single lang state: controls both view-mode title and edit-mode input
  const initialLang = i18n.language === "en" ? "en" : "ja";
  const [displayLang, setDisplayLang] = useState<"ja" | "en">(initialLang);

  // Inline edit state
  const [editMode, setEditMode] = useState(false);
  const [editTitleJa, setEditTitleJa] = useState(page.titleJa);
  const [editTitleEn, setEditTitleEn] = useState(page.titleEn);

  // Single visibility state: used by the always-visible dropdown
  const [currentVisibility, setCurrentVisibility] = useState(page.visibility);

  // Star / share / archive state
  const [currentStarred, setCurrentStarred] = useState(isStarred);
  const [shareOpen, setShareOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const optimisticStarred = favFetcher.state !== "idle" ? !currentStarred : currentStarred;

  // Sync visibility with reloaded page data (when not editing, or when Cancel is clicked)
  useEffect(() => {
    if (!editMode) setCurrentVisibility(page.visibility);
  }, [page.visibility, editMode]);

  // Exit edit mode when save succeeds; revalidate to refresh page data
  useEffect(() => {
    if (settingsFetcher.data?.ok) {
      setEditMode(false);
      revalidator.revalidate();
    }
  }, [settingsFetcher.data, revalidator]);

  // Revalidate after immediate visibility change
  useEffect(() => {
    if (visibilityFetcher.data?.ok) {
      revalidator.revalidate();
    }
  }, [visibilityFetcher.data, revalidator]);

  // Sync star state on navigation
  useEffect(() => {
    setCurrentStarred(isStarred);
  }, [isStarred]);

  // Close "more" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const title = displayLang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;

  function handleEditStart() {
    setEditTitleJa(page.titleJa);
    setEditTitleEn(page.titleEn);
    setEditMode(true);
  }

  function handleEditCancel() {
    setEditMode(false);
  }

  function handleSave() {
    const fd = new FormData();
    fd.set("intent", "updateSettings");
    fd.set("titleJa", editTitleJa);
    fd.set("titleEn", editTitleEn);
    fd.set("visibility", currentVisibility);
    settingsFetcher.submit(fd, { method: "post" });
  }

  function handleVisibilityChange(val: string) {
    setCurrentVisibility(val);
    if (!editMode) {
      const fd = new FormData();
      fd.set("intent", "setVisibility");
      fd.set("visibility", val);
      visibilityFetcher.submit(fd, { method: "post" });
    }
  }

  function handleToggleStar() {
    favFetcher.submit({ intent: "toggleFavorite", pageId: page.id }, { method: "post" });
  }

  function handleShare() {
    setShareOpen(true);
  }

  const handleUpdate = useCallback(
    async (taskId: string, fieldOrUpdates: string | Record<string, unknown>, value?: unknown) => {
      const body =
        typeof fieldOrUpdates === "string" ? { [fieldOrUpdates]: value } : fieldOrUpdates;
      const response = await fetch(`/api/tasks/${taskListId}/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await ensureOkResponse(response);
      revalidator.revalidate();
    },
    [taskListId, revalidator],
  );

  const handleCreate = useCallback(
    async (data: {
      title: string;
      description: string;
      status: string;
      type: string;
      dueDate: string | null;
      assigneeId: string | null;
      assigneeName: string | null;
      teamId: string | null;
      dependencies: string[];
    }) => {
      const response = await fetch(`/api/tasks/${taskListId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await ensureOkResponse(response);
      revalidator.revalidate();
    },
    [taskListId, revalidator],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      const response = await fetch(`/api/tasks/${taskListId}/${taskId}`, { method: "DELETE" });
      await ensureOkResponse(response);
      revalidator.revalidate();
    },
    [taskListId, revalidator],
  );

  const handleTaskClick = useCallback((_taskId: string) => {}, []);

  const tabs: { key: ViewTab; label: string; icon: ReactNode }[] = [
    { key: "table", label: t("tasks.view_table"), icon: <LayoutList size={14} /> },
    { key: "timeline", label: t("tasks.view_timeline"), icon: <CalendarDays size={14} /> },
    { key: "remaining", label: t("tasks.view_remaining"), icon: <ListChecks size={14} /> },
  ];

  const visibilityOptions: DropdownOption[] = [
    { value: "restricted", label: t("wiki.visibility_restricted") },
    { value: "public", label: t("wiki.visibility_public") },
    { value: "private_to_chapter", label: t("wiki.visibility_chapter") },
    { value: "private_to_lead", label: t("wiki.visibility_lead") },
  ];

  const btnBase =
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700";

  return (
    <div>
      {/* Mini-header toolbar — mirrors wiki.$slug.tsx */}
      <div className="flex items-center justify-end gap-2 border-b border-gray-100 px-4 py-2 md:px-10">
        {/* Desktop action buttons (md+) */}
        <div className="hidden items-center gap-1 md:flex">
          <Link to={`/tasks/${page.slug}/history`} className={btnBase}>
            <History size={14} />
            {t("tasks.history")}
          </Link>
          <button
            type="button"
            onClick={handleToggleStar}
            className={btnBase}
            style={optimisticStarred ? { color: "#E06C00" } : undefined}
          >
            <Star
              size={14}
              style={optimisticStarred ? { fill: "#E06C00", color: "#E06C00" } : undefined}
            />
            {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
          </button>
          <button type="button" onClick={handleShare} className={btnBase}>
            <Share2 size={14} />
            {t("wiki.share")}
          </button>
          <Tooltip label={t("tasks.archive_no_permission")} disabled={!canArchive}>
            <button
              type="button"
              onClick={canArchive ? () => setArchiveDialogOpen(true) : undefined}
              disabled={!canArchive}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
            >
              <Archive size={14} />
              {t("wiki.archive")}
            </button>
          </Tooltip>
        </div>

        {/* Mobile "more" dropdown (<md) */}
        <div ref={moreRef} className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className={btnBase}
            aria-label="More actions"
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
              <Link
                to={`/tasks/${page.slug}/history`}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                onClick={() => setMoreOpen(false)}
              >
                <History size={14} />
                {t("tasks.history")}
              </Link>
              <button
                type="button"
                onClick={() => {
                  handleToggleStar();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                style={optimisticStarred ? { color: "#E06C00" } : undefined}
              >
                <Star
                  size={14}
                  style={optimisticStarred ? { fill: "#E06C00", color: "#E06C00" } : undefined}
                />
                {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleShare();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                <Share2 size={14} />
                {t("wiki.share")}
              </button>
              <Tooltip label={t("tasks.archive_no_permission")} disabled={!canArchive}>
                <button
                  type="button"
                  onClick={
                    canArchive
                      ? () => {
                          setArchiveDialogOpen(true);
                          setMoreOpen(false);
                        }
                      : undefined
                  }
                  disabled={!canArchive}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
                >
                  <Archive size={14} />
                  {t("wiki.archive")}
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-6 pb-4 md:px-10">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
          {/* Left: title or title input */}
          {editMode ? (
            <input
              type="text"
              value={displayLang === "ja" ? editTitleJa : editTitleEn}
              onChange={(e) => {
                if (displayLang === "ja") setEditTitleJa(e.target.value);
                else setEditTitleEn(e.target.value);
              }}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xl font-bold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <h1 className="min-w-0 truncate text-2xl font-bold">{title}</h1>
          )}

          {/* Right: JA|EN pill + visibility + Edit/Save/Cancel */}
          <div className="flex shrink-0 items-center gap-2">
            {/* JA|EN — wiki-style pill */}
            <div className="flex gap-1 rounded-md border border-gray-200 bg-white p-0.5">
              {(["ja", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setDisplayLang(l)}
                  className={`min-w-10 rounded px-2 py-1 text-center text-sm font-medium transition-colors ${
                    displayLang === l ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {l === "ja" ? "JA" : "EN"}
                </button>
              ))}
            </div>

            {/* Visibility: always a dropdown for leads */}
            {canChangeVisibility && (
              <DropdownMenu
                value={currentVisibility}
                options={visibilityOptions}
                onChange={handleVisibilityChange}
                variant="filter"
              />
            )}

            {/* Edit / Save+Cancel */}
            {editMode ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Check size={14} />
                  {t("tasks.save")}
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  <X size={14} />
                  {t("cancel")}
                </button>
              </>
            ) : (
              canManage && (
                <button
                  type="button"
                  onClick={handleEditStart}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  <Pencil size={14} />
                  {t("wiki.edit")}
                </button>
              )
            )}
          </div>
        </div>

        {/* View switcher */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${
                  activeTab === tab.key
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* View content */}
      {activeTab === "table" && (
        <TaskTableView
          tasks={tasks}
          teams={teams}
          members={members}
          onUpdate={handleUpdate}
          onTaskClick={handleTaskClick}
          onCreate={handleCreate}
          onDelete={handleDelete}
          nextTaskNumber={nextTaskNumber}
          canManage={canManage}
          taskListId={taskListId}
          onTeamsRefresh={() => revalidator.revalidate()}
        />
      )}
      {activeTab === "timeline" && (
        <TaskTimelineView tasks={tasks} members={members} onTaskClick={handleTaskClick} />
      )}
      {activeTab === "remaining" && (
        <TaskRemainingView tasks={tasks} members={members} onTaskClick={handleTaskClick} />
      )}

      <ConfirmDialog
        open={archiveDialogOpen}
        title={t("wiki.archive")}
        message={t("tasks.archive_confirm")}
        confirmLabel={t("wiki.archive")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          archiveFetcher.submit({ intent: "archivePage" }, { method: "post" });
          setArchiveDialogOpen(false);
        }}
        onCancel={() => setArchiveDialogOpen(false)}
      />

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        pageId={page.id}
        pageTitle={title}
        currentVisibility={page.visibility}
        canManageAccess={canManageAccess}
        canChangeVisibility={canChangeVisibility}
      />
    </div>
  );
}
