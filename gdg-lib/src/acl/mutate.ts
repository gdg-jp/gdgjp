import type { PageSubject, PermissionClass } from "./types";

export function canMutatePage(classes: readonly PermissionClass[], page: PageSubject): boolean {
  if (classes.length === 0) return false;
  if (classes.some((permissionClass) => permissionClass.role === "organizer")) return true;
  if (page.visibility === "public" || page.visibility === "unlisted") return true;
  if (page.chapterId === null) return false;
  return classes.some(
    (permissionClass) => String(permissionClass.chapterId) === String(page.chapterId),
  );
}
