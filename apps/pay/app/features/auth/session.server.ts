import type { AuthUser, UserChapter, UserClaims } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/features/auth/auth.server";

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

export async function getOptionalUser(env: Env, request: Request): Promise<AuthUser | null> {
  return getAuth(env).getSessionUser(request);
}

export async function requireMember(
  env: Env,
  request: Request,
): Promise<{ user: AuthUser; claims: UserClaims; chapters: UserChapter[] }> {
  const user = await requireUser(env, request);
  let claims: UserClaims;
  try {
    claims = await getAuth(env).getFreshClaims(request);
  } catch {
    throw buildSignInRedirect(request);
  }
  if (claims.chapters.length === 0) {
    throw new Response("チャプターのメンバーシップが必要です", { status: 403 });
  }
  return { user, claims, chapters: claims.chapters };
}
