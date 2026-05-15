type UserLike = {
  id: string;
  isAdmin: boolean | null | undefined;
};

type TaskLike = {
  createdBy: string;
};

type TaskListPageLike = {
  authorId: string;
};

/**
 * Returns true if the user can edit/delete this task.
 * Allowed: task creator, list author, admins. (Pre-SSO "chapter lead"
 * was also allowed; that role no longer exists locally — admins handle
 * cross-chapter moderation.)
 */
export function canUserEditTask(
  user: UserLike,
  task: TaskLike,
  listPage: TaskListPageLike,
): boolean {
  if (user.isAdmin) return true;
  if (user.id === task.createdBy) return true;
  if (user.id === listPage.authorId) return true;
  return false;
}
