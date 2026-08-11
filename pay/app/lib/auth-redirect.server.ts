import type { AuthUser, UserChapter, UserClaims } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { getAuth } from "~/lib/auth.server";

export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return null;
  }
  return value;
}

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

export function canProxyForEvent(
  actor: { userId: string; chapters: UserChapter[] },
  event: { ownerUserId: string; ownerChapterIds: number[] },
): boolean {
  if (actor.userId === event.ownerUserId) return true;
  return actor.chapters.some(
    (chapter) => chapter.role === "organizer" && event.ownerChapterIds.includes(chapter.chapterId),
  );
}

export function canViewAllClaims(
  actor: { userId: string; chapters: UserChapter[] },
  event: { ownerUserId: string; ownerChapterIds: number[] },
): boolean {
  return canProxyForEvent(actor, event);
}
