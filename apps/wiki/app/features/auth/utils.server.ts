import type { AuthUser } from "@gdgjp/gdg-lib";
import { createAuth } from "./auth.server";
import { buildSignInRedirect } from "./redirect";

export type { AuthUser };

export interface AccessIdentity {
  user: AuthUser | null;
  chapterIds: string[];
  chapters: Array<{ chapterId: string; chapterSlug: string; role: string }>;
  claimsAvailable: boolean;
}

export function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  return createAuth(env).getSessionUser(request);
}

export async function getAccessIdentity(request: Request, env: Env): Promise<AccessIdentity> {
  const auth = createAuth(env);
  const user = await auth.getSessionUser(request);
  if (!user) return { user: null, chapterIds: [], chapters: [], claimsAvailable: true };

  const claims = await auth.getFreshClaims(request);
  return {
    user,
    chapterIds: claims.chapters.map((chapter) => String(chapter.chapterId)),
    chapters: claims.chapters.map((chapter) => ({
      chapterId: String(chapter.chapterId),
      chapterSlug: chapter.chapterSlug,
      role: chapter.role,
    })),
    claimsAvailable: true,
  };
}

export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const user = await getSessionUser(request, env);
  if (!user) throw buildSignInRedirect(request);
  return user;
}

export async function requireAdmin(request: Request, env: Env): Promise<AuthUser> {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new Response(null, { status: 403 });
  return user;
}
