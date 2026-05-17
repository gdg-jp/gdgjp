import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/lib/auth.server";
import { type UserChapter, fetchChapterForUser } from "~/lib/chapter.server";

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
  let chapter: UserChapter | null;
  try {
    chapter = await fetchChapterForUser(env, request);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }
  if (!chapter) throw redirect("/no-chapter");
  // Post-migration there is no separate accountId — user.id is our stable
  // internal identifier (a UUID minted at first sign-in). New image rows store
  // the same value in both user_id and account_id; existing rows keep their
  // historical account_id (Google sub) for backward-compat reads.
  return { user, chapter, accountId: user.id };
}
