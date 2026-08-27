import type { ContributorAdminActor } from "./contributor.types";

/**
 * Listing, adding, and removing contributors is an organizer (or super-admin)
 * capability. Being a contributor only grants post access — it never grants
 * contributor administration.
 */
export function canAdministerContributors(actor: ContributorAdminActor): boolean {
  return actor.role === "organizer" || actor.isSuperAdmin;
}
