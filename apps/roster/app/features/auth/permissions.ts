import type { UserChapter } from "@gdgjp/gdg-lib";
import type { ApplicationRecord } from "~/features/applications/types";
import type { EventRecord } from "~/features/events/events.server";

export type PermissionEvent = Pick<EventRecord, "chapterId">;

export function canManageEvent(chapters: readonly UserChapter[], event: PermissionEvent): boolean {
  return chapters.some((chapter) => chapter.chapterId === event.chapterId);
}

export type PermissionApplication = Pick<ApplicationRecord, "userId">;

export function canEditApplication(
  viewer: { userId: string } | null,
  chapters: readonly UserChapter[],
  event: PermissionEvent,
  application: PermissionApplication,
): boolean {
  if (canManageEvent(chapters, event)) return true;
  return viewer !== null && application.userId === viewer.userId;
}
