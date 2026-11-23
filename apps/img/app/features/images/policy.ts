import { type AuthUser, type UserChapter, isSuperAdmin } from "@gdgjp/gdg-lib";
import type { ImageRow } from "./repository.server";

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
