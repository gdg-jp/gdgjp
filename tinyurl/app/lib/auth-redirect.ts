import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/lib/auth.server";
import { type UserChapter, fetchChapterForUser } from "~/lib/chapter.server";

export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  return redirect(`/signin?return_to=${encodeURIComponent(target)}`);
}

export async function requireUserWithChapter(
  env: Env,
  request: Request,
): Promise<{ user: AuthUser; chapter: UserChapter }> {
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(request);
  } catch {
    throw buildSignInRedirect(request);
  }
  let chapter: UserChapter | null;
  try {
    chapter = await fetchChapterForUser(env, user.id);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) throw buildSignInRedirect(request);
    throw err;
  }
  if (!chapter) throw redirect("/no-chapter");
  return { user, chapter };
}
