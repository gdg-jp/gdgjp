import type { ContributorDependencies } from "./contributor.types";

export function contributorDepsFromEnv(env: Env): ContributorDependencies {
  return { db: env.DB };
}
