import type { AuthUser } from "@gdgjp/gdg-lib";
import type { SourceVisibility } from "~/features/sources/shared";
import { isSourceVisibility, sourceVisibilityNeedsChapter } from "~/features/sources/shared";

export type Membership = { chapterId: string | number; role: string };

export function canAssignChapter(
  chapterId: string | null | undefined,
  user: AuthUser,
  chapterIds: readonly string[],
): boolean {
  if (chapterId == null || chapterId === "") return true;
  if (user.isAdmin) return true;
  return chapterIds.includes(chapterId);
}

export function canAssignSourceVisibility(
  visibility: SourceVisibility,
  chapterId: string | null,
  user: AuthUser,
  chapters: readonly Membership[],
): boolean {
  const needsChapter = sourceVisibilityNeedsChapter(visibility);
  if (needsChapter !== (chapterId != null && chapterId !== "")) return false;

  if (!needsChapter) return true;
  if (user.isAdmin) return true;
  return chapters.some((chapter) => String(chapter.chapterId) === chapterId);
}

export function parseSourceVisibilitySelection(
  rawVisibility: unknown,
  rawChapter: unknown,
):
  | { ok: true; visibility: SourceVisibility; chapterId: string | null }
  | { ok: false; error: string } {
  if (!isSourceVisibility(rawVisibility)) {
    return { ok: false, error: "invalid_visibility" };
  }

  const needsChapter = sourceVisibilityNeedsChapter(rawVisibility);
  const chapterId = typeof rawChapter === "string" && rawChapter.length > 0 ? rawChapter : null;

  if (needsChapter && chapterId === null) {
    return { ok: false, error: "chapter_required" };
  }
  if (!needsChapter && chapterId !== null) {
    return { ok: false, error: "invalid_visibility" };
  }

  return { ok: true, visibility: rawVisibility, chapterId };
}
