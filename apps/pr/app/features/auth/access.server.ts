import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/features/auth/auth.server";
import {
  type UserChapter,
  type UserChapters,
  fetchChaptersForUser,
} from "~/features/auth/chapter.server";
import { pickChapter } from "~/features/auth/current-chapter";

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  return redirect(`/signin?return_to=${encodeURIComponent(target)}`);
}

/**
 * Any signed-in page: require a session + at least one chapter membership. `chapter` is the one
 * picked in the sidebar (cookie), falling back to the first membership.
 */
export async function requireUserWithChapter(
  env: Env,
  request: Request,
): Promise<{ user: AuthUser; chapter: UserChapter; chapters: UserChapter[] }> {
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(request);
  } catch (e) {
    // 401 means signed out (or signed in as someone else at Accounts); a 503
    // from an unreachable IdP must surface instead of looping through sign-in.
    if (e instanceof Response && e.status === 401) throw buildSignInRedirect(request);
    throw e;
  }
  let resolved: UserChapters;
  try {
    resolved = await fetchChaptersForUser(env, request);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }
  if (!resolved.primary) throw redirect("/no-chapter");
  const chapter = pickChapter(request.headers.get("Cookie"), resolved.all) ?? resolved.primary;
  return { user, chapter, chapters: resolved.all };
}

export async function getOptionalUser(env: Env, request: Request): Promise<AuthUser | null> {
  return getAuth(env).getSessionUser(request);
}
