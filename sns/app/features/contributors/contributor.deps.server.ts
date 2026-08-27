import type { ContributorDependencies } from "./contributor.types";

/** Wires the contributor service to the Worker's D1 binding. */
export function contributorDepsFromEnv(env: Env): ContributorDependencies {
  return { db: env.DB };
}
