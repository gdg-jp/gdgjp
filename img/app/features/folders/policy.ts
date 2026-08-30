import { type AuthUser, type UserChapter, isSuperAdmin } from "@gdgjp/gdg-lib";
import type { FolderRow } from "./repository";

/**
 * A folder is chapter-owned: any member of that chapter (or a super admin)
 * can view it, rename it, delete it, or assign images to it. There is no
 * separate editor/viewer split, matching image access.
 */
export function canAccessFolder(
  actor: { user: AuthUser; chapters: UserChapter[] },
  folder: FolderRow,
): boolean {
  return (
    isSuperAdmin(actor.user) ||
    actor.chapters.some((chapter) => chapter.chapterId === folder.chapterId)
  );
}
