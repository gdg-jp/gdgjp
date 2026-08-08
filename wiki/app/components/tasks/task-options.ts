export const STATUSES = ["todo", "in_progress", "done", "cancelled", "duplicated"] as const;
export const TYPES = ["task", "discussion"] as const;

export const STATUS_CHIP: Record<string, string> = {
  todo: "bg-task-todo-surface text-task-todo-foreground",
  in_progress: "bg-task-in-progress-surface text-task-in-progress-foreground",
  done: "bg-task-done-surface text-task-done-foreground",
  cancelled: "bg-task-cancelled-surface text-task-cancelled-foreground",
  duplicated: "bg-task-duplicated-surface text-task-duplicated-foreground",
};

export const TYPE_CHIP: Record<string, string> = {
  task: "bg-feedback-danger-surface text-feedback-danger-foreground",
  discussion: "bg-feedback-info-surface text-action-primary",
};
