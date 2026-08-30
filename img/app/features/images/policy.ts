import { type AuthUser, type UserChapter, isSuperAdmin } from "@gdgjp/gdg-lib";
import type { ImageRow } from "./repository";

/**
 * An image is accessible (view AND mutate — this app does not distinguish
 * editor/viewer roles) to its uploader, a super admin, or any member of the
 * chapter it is shared with.
 */
export function canAccessImage(
  actor: { user: AuthUser; chapters: UserChapter[] },
  image: ImageRow,
): boolean {
  return (
    image.userId === actor.user.id ||
    isSuperAdmin(actor.user) ||
    actor.chapters.some((chapter) => chapter.chapterId === image.chapterId)
  );
}

/**
 * Whether the actor may re-share an image into the given chapter: a super
 * admin may target any chapter, everyone else must already belong to it.
 * Callers should skip this check when chapterId is unchanged (a no-op
 * "reassignment" back to the image's current chapter is always fine and
 * doesn't require membership in it).
 */
export function canShareImageWithChapter(
  actor: { user: AuthUser; chapters: UserChapter[] },
  chapterId: number,
): boolean {
  return (
    isSuperAdmin(actor.user) || actor.chapters.some((chapter) => chapter.chapterId === chapterId)
  );
}

export type ResolvedChapter =
  | { ok: true; chapterId: number }
  | { ok: false; error: "forbidden" | "chapter_required" };

/**
 * Selects which chapter an upload should be attributed to for a bearer-token
 * caller with potentially several memberships: a single membership is implicit,
 * several require an explicit (and validated) choice, none is unauthorized.
 */
export function resolveActorChapter(
  chapters: UserChapter[],
  requestedChapterId: number | null,
): ResolvedChapter {
  if (chapters.length === 0) return { ok: false, error: "forbidden" };
  if (requestedChapterId === null) {
    if (chapters.length === 1) return { ok: true, chapterId: chapters[0].chapterId };
    return { ok: false, error: "chapter_required" };
  }
  return chapters.some((chapter) => chapter.chapterId === requestedChapterId)
    ? { ok: true, chapterId: requestedChapterId }
    : { ok: false, error: "forbidden" };
}
