import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/features/auth/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

export type UserChapters = {
  primary: UserChapter | null;
  all: UserChapter[];
};

/**
 * The user's chapter memberships as accounts.gdgs.jp reports them for this
 * request. gdg-lib checks the IdP session once per request, so a membership
 * change applies on the next request; `/dev/login` sessions carry their own
 * chapters.
 */
export async function fetchChaptersForUser(env: Env, request: Request): Promise<UserChapters> {
  const user = await getAuth(env).getSessionUser(request);
  if (!user) return { primary: null, all: [] };
  const claims = await getAuth(env).getFreshClaims(request);
  return { primary: claims.chapter, all: claims.chapters };
}

/** Convenience wrapper for callers that only need the primary chapter. */
export async function fetchChapterForUser(env: Env, request: Request): Promise<UserChapter | null> {
  return (await fetchChaptersForUser(env, request)).primary;
}
