import type { UserChapter } from "@gdgjp/gdg-lib";

export function canProxyForEvent(
  actor: { userId: string; chapters: UserChapter[] },
  event: { ownerUserId: string; ownerChapterIds: number[] },
): boolean {
  if (actor.userId === event.ownerUserId) return true;
  return actor.chapters.some(
    (chapter) => chapter.role === "organizer" && event.ownerChapterIds.includes(chapter.chapterId),
  );
}

export function canViewAllClaims(
  actor: { userId: string; chapters: UserChapter[] },
  event: { ownerUserId: string; ownerChapterIds: number[] },
): boolean {
  return canProxyForEvent(actor, event);
}
