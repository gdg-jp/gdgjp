import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/lib/auth.server";
import {
  type UserChapter,
  type UserChapterClaims,
  fetchChapterClaimsForUser,
  getLinkedAccountId,
} from "~/lib/chapter.server";

export { safeReturnTo } from "~/lib/return-to";

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  return redirect(`/signin?return_to=${encodeURIComponent(target)}`);
}

export async function requireUserWithChapter(
  env: Env,
  request: Request,
): Promise<{ user: AuthUser; chapter: UserChapter; accountId: string }> {
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(request);
  } catch (e) {
    if (e instanceof Response && e.status === 401) throw buildSignInRedirect(request);
    throw e;
  }
  let claims: UserChapterClaims;
  try {
    claims = await fetchChapterClaimsForUser(env, user.id);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }
  if (!claims.chapter) throw redirect("/no-chapter");
  const accountId = await getLinkedAccountId(env.DB, user.id);
  if (!accountId) throw redirect("/no-chapter");
  return {
    user: { ...user, isAdmin: claims.isAdmin },
    chapter: claims.chapter,
    accountId,
  };
}
