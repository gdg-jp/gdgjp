import { useValueChange } from "@gdgjp/gdg-lib/react";
import { type ReactNode, Suspense, useCallback, useState } from "react";
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

import { Icons } from "@gdgjp/design-system";
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

  const initialLang = i18n.language === "en" ? "en" : "ja";
  const [displayLang, setDisplayLang] = useState<"ja" | "en">(initialLang);

  const [editMode, setEditMode] = useState(false);
  const [editTitleJa, setEditTitleJa] = useState(page.titleJa);
  const [editTitleEn, setEditTitleEn] = useState(page.titleEn);

  const [shareOpen, setShareOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  useValueChange(settingsFetcher.data, (result) => {
    if (result?.ok) {
      setEditMode(false);
      revalidator.revalidate();
    }
  });

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
    { key: "table", label: t("tasks.view_table"), icon: <Icons name="LayoutList" size={14} /> },
    {
      key: "timeline",
      label: t("tasks.view_timeline"),
      icon: <Icons name="CalendarDays" size={14} />,
    },
    {
      key: "remaining",
      label: t("tasks.view_remaining"),
      icon: <Icons name="ListChecks" size={14} />,
    },
  ];

  return (
    <div>
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
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
          {editMode ? (
            <input
              type="text"
              value={displayLang === "ja" ? editTitleJa : editTitleEn}
              onChange={(e) => {
                if (displayLang === "ja") setEditTitleJa(e.target.value);
                else setEditTitleEn(e.target.value);
              }}
              className="min-w-0 flex-1 rounded-md border border-border px-3 py-1.5 text-xl font-bold focus:border-border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <h1 className="min-w-0 truncate text-2xl font-bold">{title}</h1>
          )}

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex gap-1 rounded-md border border-border bg-surface p-0.5">
              {(["ja", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setDisplayLang(l)}
                  className={`min-w-10 rounded px-2 py-1 text-center text-sm font-medium transition-colors ${
                    displayLang === l
                      ? "bg-primary text-primary-foreground"
                      : "text-muted hover:bg-neutral"
                  }`}
                >
                  {l === "ja" ? "JA" : "EN"}
                </button>
              ))}
            </div>

            {editMode ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Icons name="Check" size={14} />
                  {t("tasks.save")}
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-neutral"
                >
                  <Icons name="X" size={14} />
                  {t("cancel")}
                </button>
              </>
            ) : (
              canManage && (
                <button
                  type="button"
                  onClick={handleEditStart}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-neutral"
                >
                  <Icons name="Pencil" size={14} />
                  {t("wiki.edit")}
                </button>
              )
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${
                  activeTab === tab.key
                    ? "bg-selected text-link"
                    : "text-muted hover:bg-neutral hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
        <Await
          resolve={taskData}
          errorElement={<div className="p-8 text-sm text-danger">Failed to load tasks.</div>}
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
