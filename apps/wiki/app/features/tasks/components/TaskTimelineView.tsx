import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatDate, getDateRange, isWeekend } from "../task-utils";
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

interface TaskTimelineViewProps {
  tasks: Task[];
  members: Member[];
  onTaskClick: (taskId: string) => void;
}

export default function TaskTimelineView({ tasks, members, onTaskClick }: TaskTimelineViewProps) {
  const { t } = useTranslation();

  const dates = useMemo(() => getDateRange(tasks), [tasks]);

  // Group tasks by assignee
  const assigneeGroups = useMemo(() => {
    const groups = new Map<string | null, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const key = task.assigneeId ?? task.assigneeName ?? null;
      const list = groups.get(key) || [];
      list.push(task);
      groups.set(key, list);
    }
    return groups;
  }, [tasks]);

  const tasksWithoutDates = tasks.filter((t) => !t.dueDate);

  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      {dates.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">{t("tasks.timeline_no_dates")}</div>
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="min-w-full">
            <thead>
              <tr className="bg-background">
                <th className="sticky left-0 z-10 min-w-[150px] bg-background px-3 py-2 text-left text-xs font-medium uppercase text-muted">
                  {t("tasks.col_assignee")}
                </th>
                {dates.map((date) => (
                  <th
                    key={date}
                    className={`min-w-[80px] px-1 py-2 text-center text-xs font-medium ${
                      date === today
                        ? "bg-selected text-link"
                        : isWeekend(date)
                          ? "bg-neutral text-muted"
                          : "text-muted"
                    }`}
                  >
                    {formatDate(date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(assigneeGroups.entries()).map(([groupKey, assigneeTasks]) => {
                const member = groupKey ? members.find((m) => m.id === groupKey) : null;
                const label = groupKey ? (member?.name ?? groupKey) : t("tasks.filter_unassigned");
                return (
                  <tr key={groupKey ?? "unassigned"} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-sm font-medium text-muted">
                      {label}
                    </td>
                    {dates.map((date) => {
                      const dateTasks = assigneeTasks.filter((t) => t.dueDate === date);
                      return (
                        <td
                          key={date}
                          className={`px-1 py-1 ${
                            date === today
                              ? "bg-selected/50"
                              : isWeekend(date)
                                ? "bg-background"
                                : ""
                          }`}
                        >
                          <div className="flex flex-col gap-0.5">
                            {dateTasks.map((task) => (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => onTaskClick(task.id)}
                                className={`w-full truncate px-1 py-0.5 text-left text-xs text-muted hover:opacity-80 ${
                                  {
                                    done: "bg-selected",
                                    in_progress: "bg-[var(--gdg-warning-surface)]",
                                    todo: "bg-[var(--gdg-success-surface)]",
                                    cancelled: "bg-neutral",
                                    duplicated: "bg-neutral",
                                  }[task.status] ?? "bg-neutral"
                                }`}
                                title={`#${task.number} ${task.title}`}
                              >
                                #{task.number}
                              </button>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tasks without due dates */}
      {tasksWithoutDates.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">{t("tasks.no_due_date")}</h3>
          <div className="flex flex-wrap gap-2">
            {tasksWithoutDates.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onTaskClick(task.id)}
                className="inline-flex items-center gap-1 border border-border px-2 py-1 text-sm hover:bg-background"
              >
                <span className="text-muted">#{task.number}</span>
                <span>{task.title}</span>
                <TaskStatusBadge status={task.status} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
