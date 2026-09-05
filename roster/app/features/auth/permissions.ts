import type { UserChapter } from "@gdgjp/gdg-lib";

/**
 * Single point of permission judgment for roster (docs/roster/index.md §6
 * "権限モデル（MVP はフラット）").
 *
 * MVP has exactly one rule: any signed-in member of the chapter that owns an
 * event — organizer or plain member, creator or not — may fully manage that
 * event. There is no per-user distinction within a chapter. Every future
 * authorization check should route through this module rather than comparing
 * `chapterId` inline, so that a future move to per-role RBAC only touches
 * this file.
 */

/** The subset of an event's fields permission checks need. Stage 02 will
 * import the real `Event` domain type and this alias will point at it;
 * callers should keep depending on this local alias rather than a concrete
 * shape so that swap stays a one-line change. */
export type PermissionEvent = {
  chapterId: number;
};

/**
 * Can any of the caller's chapter memberships manage this event? True iff the
 * caller belongs to the chapter that owns the event — see the module doc
 * comment for why membership alone (not role) is sufficient in the MVP.
 */
export function canManageEvent(chapters: readonly UserChapter[], event: PermissionEvent): boolean {
  return chapters.some((chapter) => chapter.chapterId === event.chapterId);
}
