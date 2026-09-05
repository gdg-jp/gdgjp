import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/features/auth/auth.server";
import {
  type UserChapter,
  type UserChapters,
  fetchChaptersForUser,
} from "~/features/auth/chapter.server";

export { safeReturnTo } from "~/lib/return-to";

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  return redirect(`/signin?return_to=${encodeURIComponent(target)}`);
}

/** Any signed-in page: require a session + at least one chapter membership. */
export async function requireUserWithChapter(
  env: Env,
  request: Request,
): Promise<{ user: AuthUser; chapter: UserChapter; chapters: UserChapter[] }> {
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(request);
  } catch {
    throw buildSignInRedirect(request);
  }
  let resolved: UserChapters;
  try {
    resolved = await fetchChaptersForUser(env, request);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }
  if (!resolved.primary) throw redirect("/no-chapter");
  return { user, chapter: resolved.primary, chapters: resolved.all };
}

export async function getOptionalUser(env: Env, request: Request): Promise<AuthUser | null> {
  return getAuth(env).getSessionUser(request);
}
