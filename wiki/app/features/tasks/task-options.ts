export const STATUSES = ["todo", "in_progress", "done", "cancelled", "duplicated"] as const;
export const TYPES = ["task", "discussion"] as const;

export const STATUS_CHIP: Record<string, string> = {
  todo: "bg-[var(--gdg-success-surface)] text-success",
  in_progress: "bg-[var(--gdg-warning-surface)] text-warning",
  done: "bg-selected text-link",
  cancelled: "bg-neutral text-muted",
  duplicated: "bg-neutral text-muted",
};

export const TYPE_CHIP: Record<string, string> = {
  task: "bg-[var(--gdg-danger-surface)] text-danger",
  discussion: "bg-selected text-link",
};
