import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { isSuperAdmin } from "@gdgjp/gdg-lib";

/**
 * A campaign is manageable by a super-admin or any member (organizer or
 * plain member) of one of its chapters. `ownerUserId` is metadata only — it
 * must never gate access on its own, in either direction.
 */
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

/**
 * Every chapter id assigned to a campaign at create/update time must be one
 * the caller actually belongs to — matching the dashboard's chapter picker,
 * which only ever offers the caller's own chapters (no super-admin bypass).
 */
export function chapterIdsAreOwnedByCaller(chapters: UserChapter[], chapterIds: number[]): boolean {
  if (chapterIds.length === 0) return false;
  const available = new Set(chapters.map((chapter) => chapter.chapterId));
  return chapterIds.every((id) => available.has(id));
}
