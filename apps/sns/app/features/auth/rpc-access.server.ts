import { type PrActor, isSuperAdmin } from "@gdgjp/gdg-lib";
import { isContributor } from "~/features/contributors/contributor.repository.server";

export async function canPostForChapter(
  db: D1Database,
  actor: PrActor,
  chapterId: number,
): Promise<boolean> {
  if (isSuperAdmin(actor.user)) return true;
  if (actor.chapters.some((c) => c.chapterId === chapterId && c.role === "organizer")) return true;
  return isContributor(db, chapterId, actor.user.email);
}
