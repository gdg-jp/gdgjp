import type { UserChapter } from "@gdgjp/gdg-lib";
import { contributorChapterIds } from "~/features/contributors/contributor.repository.server";

export async function listAccessibleChapters(
  db: D1Database,
  email: string,
  memberships: UserChapter[],
  isSuperAdmin = false,
): Promise<
  { chapterId: number; chapterSlug: string; role: "organizer" | "member" | "contributor" }[]
> {
  const contributorIds = new Set(await contributorChapterIds(db, email));
  const chapters: {
    chapterId: number;
    chapterSlug: string;
    role: "organizer" | "member" | "contributor";
  }[] = memberships.map((chapter) => ({ ...chapter }));
  for (const chapterId of contributorIds) {
    if (!chapters.some((chapter) => chapter.chapterId === chapterId)) {
      chapters.push({ chapterId, chapterSlug: `chapter-${chapterId}`, role: "contributor" });
    }
  }
  // A super-admin keeps every chapter they are a member of; everyone else only
  // reaches sns as an organizer or a contributor of the chapter.
  return chapters.filter(
    (chapter) =>
      isSuperAdmin || chapter.role === "organizer" || contributorIds.has(chapter.chapterId),
  );
}
