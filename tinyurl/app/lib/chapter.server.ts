import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/lib/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

export type UserChapters = {
  primary: UserChapter | null;
  all: UserChapter[];
  isAdmin: boolean;
};

export async function fetchChaptersForUser(env: Env, tinyurlUserId: string): Promise<UserChapters> {
  const claims = await getAuth(env).getFreshClaims(tinyurlUserId);
  return { primary: claims.chapter, all: claims.chapters, isAdmin: claims.isAdmin };
}

export async function fetchChapterForUser(
  env: Env,
  tinyurlUserId: string,
): Promise<UserChapter | null> {
  return (await fetchChaptersForUser(env, tinyurlUserId)).primary;
}
