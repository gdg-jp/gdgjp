import type { PrActor } from "@gdgjp/gdg-lib";
import {
  type AllowedGroup,
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "./authorize.server";

/**
 * The service-binding twin of the Bearer routes' group check: pr passes the actor, and the same
 * canReadGroup / canWriteGroup decide (an allowlisted group of the actor's chapter; write needs
 * an organizer of it, or a super admin).
 */
export async function groupForPrActor(
  db: D1Database,
  actor: PrActor,
  rawGroupSlug: string,
  write: boolean,
): Promise<AllowedGroup | null> {
  const group = await getAllowedGroup(db, resolveGroupSlug(rawGroupSlug));
  if (!group) return null;
  const identity = { user: actor.user, chapters: actor.chapters } as Parameters<
    typeof canReadGroup
  >[0];
  return (write ? canWriteGroup(identity, group) : canReadGroup(identity, group)) ? group : null;
}
