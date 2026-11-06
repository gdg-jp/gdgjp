import { type PrActor, isSuperAdmin } from "@gdgjp/gdg-lib";
import { isContributor } from "~/features/contributors/contributor.repository.server";

/**
 * The service-binding twin of `requireSnsAccess`: an organizer of the chapter, a super admin,
 * or a contributor of the chapter may post. No Request, cookie or redirect: pr passes the actor.
 */
export async function canPostForChapter(
  db: D1Database,
  actor: PrActor,
  chapterId: number,
): Promise<boolean> {
  if (isSuperAdmin(actor.user)) return true;
  if (actor.chapters.some((c) => c.chapterId === chapterId && c.role === "organizer")) return true;
  return isContributor(db, chapterId, actor.user.email);
}
