import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/lib/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

export type UserChapterClaims = {
  chapter: UserChapter | null;
  isAdmin: boolean;
};

export async function fetchChapterClaimsForUser(
  env: Env,
  imgUserId: string,
): Promise<UserChapterClaims> {
  const claims = await getAuth(env).getFreshClaims(imgUserId);
  return { chapter: claims.chapter, isAdmin: claims.isAdmin };
}

export async function fetchChapterForUser(
  env: Env,
  imgUserId: string,
): Promise<UserChapter | null> {
  return (await fetchChapterClaimsForUser(env, imgUserId)).chapter;
}

export async function getLinkedAccountId(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT accountId FROM account WHERE userId = ? AND providerId = 'gdgjp' ORDER BY createdAt DESC LIMIT 1",
    )
    .bind(userId)
    .first<{ accountId: string }>();
  return row?.accountId ?? null;
}
