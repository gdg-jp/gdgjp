import { type AuthUser, type UserChapter, isSuperAdmin } from "@gdgjp/gdg-lib";
import type { ImageRow } from "./repository";

export function canMutateImage(user: AuthUser, image: ImageRow): boolean {
  return image.userId === user.id || isSuperAdmin(user);
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
