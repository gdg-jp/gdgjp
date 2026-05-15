export const STATUSES = ["todo", "in_progress", "done", "cancelled", "duplicated"] as const;
export const TYPES = ["task", "discussion"] as const;

export const STATUS_CHIP: Record<string, string> = {
  todo: "bg-green-100 text-green-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  done: "bg-blue-100 text-blue-700",
  cancelled: "bg-gray-100 text-gray-700",
  duplicated: "bg-gray-100 text-gray-700",
};

export const TYPE_CHIP: Record<string, string> = {
  task: "bg-red-100 text-red-700",
  discussion: "bg-blue-100 text-blue-700",
};
