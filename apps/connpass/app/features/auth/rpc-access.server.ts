import type { PrActor } from "@gdgjp/gdg-lib";
import {
  type AllowedGroup,
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "./authorize.server";

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
