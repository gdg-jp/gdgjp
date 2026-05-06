import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/lib/auth.server";
import { type UserChapter, fetchChapterForUser, getLinkedAccountId } from "~/lib/chapter.server";

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
    chapter = await fetchChapterForUser(env, user.id);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }
  if (!chapter) throw redirect("/no-chapter");
  const accountId = await getLinkedAccountId(env.DB, user.id);
  if (!accountId) throw redirect("/no-chapter");
  return { user, chapter, accountId };
}
