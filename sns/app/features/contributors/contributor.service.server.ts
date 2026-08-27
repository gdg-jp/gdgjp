import { nowIso } from "~/lib/utils";
import {
  deleteContributor,
  insertContributor,
  listContributors,
  listContributorsPage,
} from "./contributor.repository.server";
import type { Contributor, ContributorDependencies } from "./contributor.types";

export async function listChapterContributors(
  deps: ContributorDependencies,
  chapterId: number,
): Promise<Contributor[]> {
  return listContributors(deps.db, chapterId);
}

/** Bounded contributor page for the CLI list endpoint. */
export async function listChapterContributorsPage(
  deps: ContributorDependencies,
  options: { chapterId: number; limit: number; offset: number },
): Promise<{ contributors: Contributor[]; hasMore: boolean }> {
  return listContributorsPage(deps.db, options);
}

export async function addContributor(
  deps: ContributorDependencies,
  chapterId: number,
  userEmail: string,
  grantedByUserId: string,
): Promise<void> {
  await insertContributor(deps.db, {
    chapterId,
    userEmail,
    grantedByUserId,
    now: nowIso(),
  });
}

export async function removeContributor(
  deps: ContributorDependencies,
  chapterId: number,
  userEmail: string,
): Promise<void> {
  await deleteContributor(deps.db, chapterId, userEmail);
}
