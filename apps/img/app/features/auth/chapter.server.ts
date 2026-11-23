import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/features/auth/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

export type UserChapters = {
  primary: UserChapter | null;
  all: UserChapter[];
};

export async function fetchChaptersForUser(env: Env, request: Request): Promise<UserChapters> {
  const user = await getAuth(env).getSessionUser(request);
  if (!user) return { primary: null, all: [] };
  const claims = await getAuth(env).getFreshClaims(request);
  return { primary: claims.chapter, all: claims.chapters };
}

export async function fetchChapterForUser(env: Env, request: Request): Promise<UserChapter | null> {
  return (await fetchChaptersForUser(env, request)).primary;
}
