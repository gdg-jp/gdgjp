import type { Membership, PageSubject, PermissionClass, SourceSubject, UserSubject } from "./types";

export function canAccessSource(
  source: SourceSubject,
  user: UserSubject,
  chapters: readonly Membership[],
): boolean {
  if (user.isAdmin) return true;
  if (source.addedBy === user.id) return true;

  switch (source.visibility) {
    case "private":
      return false;
    case "member":
      return chapters.length > 0;
    case "organizer":
      return chapters.some((chapter) => chapter.role === "organizer");
    case "chapter-member":
      return chapters.some((chapter) => String(chapter.chapterId) === source.chapterId);
    case "chapter-organizer":
      return chapters.some(
        (chapter) => String(chapter.chapterId) === source.chapterId && chapter.role === "organizer",
      );
    default:
      return false;
  }
}

export function canClassesAccessSource(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
): boolean {
  switch (source.visibility) {
    case "private":
      return false;
    case "member":
      return classes.length > 0;
    case "organizer":
      return classes.some((permissionClass) => permissionClass.role === "organizer");
    case "chapter-member":
      return classes.some(
        (permissionClass) => String(permissionClass.chapterId) === source.chapterId,
      );
    case "chapter-organizer":
      return classes.some(
        (permissionClass) =>
          String(permissionClass.chapterId) === source.chapterId &&
          permissionClass.role === "organizer",
      );
    default:
      return false;
  }
}

export function canClassesSeePage(page: PageSubject, classes: readonly PermissionClass[]): boolean {
  switch (page.visibility) {
    case "public":
    case "unlisted":
      return true;
    case "member":
      return classes.length > 0;
    case "organizer":
      return classes.some((permissionClass) => permissionClass.role === "organizer");
    case "restricted":
      return page.access.some(
        (entry) =>
          entry.subjectType === "chapter" &&
          classes.some((permissionClass) => String(permissionClass.chapterId) === entry.subjectKey),
      );
    default:
      return false;
  }
}
