import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import TaskStatusBadge from "./TaskStatusBadge";

interface Task {
  id: string;
  number: number;
  title: string;
  status: string;
  type: string;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
}

interface Member {
  id: string;
  name: string;
}

interface TaskRemainingViewProps {
  tasks: Task[];
  members: Member[];
  onTaskClick: (taskId: string) => void;
}

const DONE_STATUSES = new Set(["done", "cancelled", "duplicated"]);

export default function TaskRemainingView({ tasks, members, onTaskClick }: TaskRemainingViewProps) {
  const { t } = useTranslation();

  const remaining = useMemo(() => tasks.filter((t) => !DONE_STATUSES.has(t.status)), [tasks]);

  // Group by assignee, sorted by due date
  const groups = useMemo(() => {
    const map = new Map<string | null, Task[]>();
    for (const task of remaining) {
      const key = task.assigneeId ?? task.assigneeName ?? null;
      const list = map.get(key) || [];
      list.push(task);
      map.set(key, list);
    }
    // Sort each group by due date (null last)
    for (const [, list] of map) {
      list.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    }
    return map;
  }, [remaining]);

  if (remaining.length === 0) {
    return <div className="py-8 text-center text-sm text-gray-400">{t("tasks.all_done")}</div>;
  }

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([groupKey, assigneeTasks]) => {
        const member = groupKey ? members.find((m) => m.id === groupKey) : null;
        const label = groupKey ? (member?.name ?? groupKey) : t("tasks.filter_unassigned");
        return (
          <div key={groupKey ?? "unassigned"}>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              {label}
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({assigneeTasks.length})
              </span>
            </h3>
            <div className="space-y-1">
              {assigneeTasks.map((task) => {
                const overdue = task.dueDate && task.dueDate < today;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onTaskClick(task.id)}
                    className="flex w-full items-center gap-3 rounded-md border border-gray-100 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <span className="text-sm text-gray-400">#{task.number}</span>
                    <TaskStatusBadge status={task.status} />
                    <span className="flex-1 truncate text-sm text-gray-900">{task.title}</span>
                    {task.dueDate && (
                      <span
                        className={`text-xs ${overdue ? "font-medium text-red-500" : "text-gray-400"}`}
                      >
                        {task.dueDate}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
