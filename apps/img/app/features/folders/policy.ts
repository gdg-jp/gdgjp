import { type AuthUser, type UserChapter, isSuperAdmin } from "@gdgjp/gdg-lib";
import type { FolderRow } from "./repository.server";

export function canAccessFolder(
  actor: { user: AuthUser; chapters: UserChapter[] },
  folder: FolderRow,
): boolean {
  return (
    isSuperAdmin(actor.user) ||
    actor.chapters.some((chapter) => chapter.chapterId === folder.chapterId)
  );
}
