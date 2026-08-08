import { useTranslation } from "react-i18next";

const STATUS_STYLES: Record<string, string> = {
  todo: "bg-task-todo-surface text-task-todo-foreground",
  in_progress: "bg-task-in-progress-surface text-task-in-progress-foreground",
  done: "bg-task-done-surface text-task-done-foreground",
  cancelled: "bg-task-cancelled-surface text-task-cancelled-foreground",
  duplicated: "bg-task-duplicated-surface text-task-duplicated-foreground",
};

export default function TaskStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.todo}`}
    >
      {t(`tasks.status_${status}`)}
    </span>
  );
}
