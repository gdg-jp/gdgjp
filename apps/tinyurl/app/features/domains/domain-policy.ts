import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { isSuperAdmin } from "@gdgjp/gdg-lib";

export function canManageChapterDomains(user: AuthUser, chapter: UserChapter): boolean {
  return isSuperAdmin(user) || chapter.role === "organizer";
}

export function manageableChapterIds(user: AuthUser, chapters: UserChapter[]): number[] {
  return chapters
    .filter((chapter) => canManageChapterDomains(user, chapter))
    .map((chapter) => chapter.chapterId);
}
