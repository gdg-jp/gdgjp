import { hasRole } from "./auth-utils.server";

type UserLike = {
  id: string;
  role: string;
  chapterId?: string | null;
};

type TaskLike = {
  createdBy: string;
};

type TaskListPageLike = {
  authorId: string;
};

/**
 * Returns true if the user can edit/delete this task.
 * Allowed: task creator, list author, leads (matching chapter), admins.
 */
export function canUserEditTask(
  user: UserLike,
  task: TaskLike,
  listPage: TaskListPageLike,
): boolean {
  if (hasRole(user.role, "admin")) return true;
  if (user.id === task.createdBy) return true;
  if (user.id === listPage.authorId) return true;
  if (hasRole(user.role, "lead")) return true;
  return false;
}
