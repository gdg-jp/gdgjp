import { CalendarDays, Check, LayoutList, ListChecks, Pencil, X } from "lucide-react";
import { type ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, useFetcher, useLoaderData, useRevalidator } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import { TableSkeleton } from "~/components/Skeleton";
import ShareDialog from "~/features/pages/components/ShareDialog";
import TaskRemainingView from "~/features/tasks/components/TaskRemainingView";
import TaskTableView from "~/features/tasks/components/TaskTableView";
import TaskTimelineView from "~/features/tasks/components/TaskTimelineView";
import type { TaskDetailData } from "../task-detail.server";
import { TaskDetailToolbar } from "./TaskDetailToolbar";

type ViewTab = "table" | "timeline" | "remaining";

async function ensureOkResponse(response: Response): Promise<void> {
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
}

export function TaskListView() {
  const {
    page,
    taskData,
    taskListId,
    canManage,
    canChangeVisibility,
    canManageAccess,
    isAuthenticated,
    nextTaskNumber,
    canArchive,
  } = useLoaderData() as TaskDetailData;
  const { t, i18n } = useTranslation();
  const revalidator = useRevalidator();
  const settingsFetcher = useFetcher<{ ok: boolean }>();
  const archiveFetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<ViewTab>("table");

  // Single lang state: controls both view-mode title and edit-mode input
  const initialLang = i18n.language === "en" ? "en" : "ja";
  const [displayLang, setDisplayLang] = useState<"ja" | "en">(initialLang);

  // Inline edit state
  const [editMode, setEditMode] = useState(false);
  const [editTitleJa, setEditTitleJa] = useState(page.titleJa);
  const [editTitleEn, setEditTitleEn] = useState(page.titleEn);

  // Share / archive state
  const [shareOpen, setShareOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  // Exit edit mode when save succeeds; revalidate to refresh page data
  useEffect(() => {
    if (settingsFetcher.data?.ok) {
      setEditMode(false);
      revalidator.revalidate();
    }
  }, [settingsFetcher.data, revalidator]);

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
    settingsFetcher.submit(fd, { method: "post" });
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

  return (
    <div>
      {/* Mini-header toolbar — mirrors wiki.$slug.tsx */}
      <TaskDetailToolbar
        slug={page.slug}
        pageId={page.id}
        isAuthenticated={isAuthenticated}
        canArchive={canArchive}
        taskData={taskData}
        onShare={handleShare}
        onArchive={() => setArchiveDialogOpen(true)}
      />

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
              className="min-w-0 flex-1 rounded-md border border-border-strong px-3 py-1.5 text-xl font-bold focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          ) : (
            <h1 className="min-w-0 truncate text-2xl font-bold">{title}</h1>
          )}

          {/* Right: JA|EN pill + visibility + Edit/Save/Cancel */}
          <div className="flex shrink-0 items-center gap-2">
            {/* JA|EN — wiki-style pill */}
            <div className="flex gap-1 rounded-md border border-border-default bg-surface-raised p-0.5">
              {(["ja", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setDisplayLang(l)}
                  className={`min-w-10 rounded px-2 py-1 text-center text-sm font-medium transition-colors ${
                    displayLang === l
                      ? "bg-action-primary text-action-primary-foreground"
                      : "text-content-secondary hover:bg-surface-hover"
                  }`}
                >
                  {l === "ja" ? "JA" : "EN"}
                </button>
              ))}
            </div>

            {/* Edit / Save+Cancel */}
            {editMode ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center gap-1 rounded-md bg-action-primary px-3 py-1.5 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover"
                >
                  <Check size={14} />
                  {t("tasks.save")}
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="inline-flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-hover"
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
                  className="inline-flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-hover"
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
                    ? "bg-feedback-info-surface text-action-primary-hover"
                    : "text-content-tertiary hover:bg-surface-hover hover:text-content-primary"
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
      <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
        <Await
          resolve={taskData}
          errorElement={
            <div className="p-8 text-sm text-feedback-danger-foreground">Failed to load tasks.</div>
          }
        >
          {({ tasks, teams, members }) => (
            <>
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
            </>
          )}
        </Await>
      </Suspense>

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

      {isAuthenticated && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          pageId={page.id}
          pageTitle={title}
          currentVisibility={page.visibility}
          canManageAccess={canManageAccess}
          canChangeVisibility={canChangeVisibility}
        />
      )}
    </div>
  );
}
