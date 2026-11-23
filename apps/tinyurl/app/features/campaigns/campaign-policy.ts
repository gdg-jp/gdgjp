import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { isSuperAdmin } from "@gdgjp/gdg-lib";

export function canAccessCampaign(
  user: AuthUser,
  chapters: UserChapter[],
  campaign: { chapterIds: number[] },
): boolean {
  return (
    isSuperAdmin(user) ||
    chapters.some((chapter) => campaign.chapterIds.includes(chapter.chapterId))
  );
}

export function chapterIdsAreOwnedByCaller(chapters: UserChapter[], chapterIds: number[]): boolean {
  if (chapterIds.length === 0) return false;
  const available = new Set(chapters.map((chapter) => chapter.chapterId));
  return chapterIds.every((id) => available.has(id));
}
