import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/features/auth/auth.server";
import {
  type UserChapter,
  type UserChapters,
  fetchChaptersForUser,
} from "~/features/auth/chapter.server";

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  return redirect(`/signin?return_to=${encodeURIComponent(target)}`);
}

export async function requireUser(env: Env, request: Request): Promise<AuthUser> {
  try {
    return await getAuth(env).requireUser(request);
  } catch (e) {
    if (e instanceof Response && e.status === 401) throw buildSignInRedirect(request);
    throw e;
  }
}

export async function requireUserWithChapter(
  env: Env,
  request: Request,
): Promise<{ user: AuthUser; chapter: UserChapter; chapters: UserChapter[] }> {
  const user = await requireUser(env, request);
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

export async function requireAdmin(env: Env, request: Request): Promise<AuthUser> {
  const user = await requireUser(env, request);
  if (!user.isAdmin) {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}
