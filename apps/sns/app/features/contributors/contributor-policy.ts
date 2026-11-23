import type { ContributorAdminActor } from "./contributor.types";

export function canAdministerContributors(actor: ContributorAdminActor): boolean {
  return actor.role === "organizer" || actor.isSuperAdmin;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
