import {
  type AuthUser,
  ClaimsUnavailableError,
  type UserChapter,
  type UserClaims,
  isSuperAdmin,
} from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { recordAudit } from "~/lib/audit.server";
import { getAuth } from "~/lib/auth.server";
import { getCachedChapter } from "~/lib/db";
import { safeReturnTo } from "~/lib/return-to";

export type { AuthUser, UserChapter };
export { ClaimsUnavailableError, safeReturnTo };

const CHAPTER_COOKIE = "discord-relay-chapter";
const DEV_CHAPTERS_COOKIE = "discord-relay-dev-chapters";

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  const returnTo = `${url.pathname}${url.search}`;
  return redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
}

export function readSelectedChapter(request: Request): number | null {
  const cookieHeader = request.headers.get("cookie") ?? request.headers.get("Cookie");
  const match = cookieHeader?.match(new RegExp(`(?:^|; )${CHAPTER_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function chapterCookie(chapterId: number): string {
  return `${CHAPTER_COOKIE}=${chapterId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`;
}

function readDevChapters(request: Request): { chapters: UserChapter[]; isAdmin?: boolean } | null {
  const cookieHeader = request.headers.get("cookie") ?? request.headers.get("Cookie");
  const match = cookieHeader?.match(new RegExp(`(?:^|; )${DEV_CHAPTERS_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    if (!parsed || typeof parsed !== "object") return null;
    const rawChapters = Array.isArray(parsed.chapters)
      ? parsed.chapters
      : Array.isArray(parsed)
        ? parsed
        : [];
    const chapters: UserChapter[] = rawChapters.filter(
      (c: unknown): c is UserChapter =>
        c !== null &&
        typeof c === "object" &&
        typeof (c as UserChapter).chapterId === "number" &&
        typeof (c as UserChapter).chapterSlug === "string" &&
        ((c as UserChapter).role === "organizer" || (c as UserChapter).role === "member"),
    );
    return { chapters, isAdmin: Boolean(parsed.isAdmin) };
  } catch {
    return null;
  }
}

export type ChapterAccess = {
  user: AuthUser;
  chapter: UserChapter;
  chapters: UserChapter[];
  isAdmin: boolean;
  crossChapter: boolean;
};

/**
 * Enforce chapter access boundaries (UC-603).
 *
 * Checks session, fetches fresh claims from IdP without caching (COND-604),
 * determines chapter boundaries, and synchronously records audit log for
 * is_admin cross-chapter access (COND-603).
 */
export async function requireChapterAccess(
  env: Env,
  request: Request,
  options?: { targetChapterId?: number },
): Promise<ChapterAccess> {
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(request);
  } catch {
    throw buildSignInRedirect(request);
  }

  // COND-604: Always call getFreshClaims() — never cache claims between requests
  let claims: UserClaims;
  try {
    claims = await getAuth(env).getFreshClaims(request);
  } catch (err) {
    if (err instanceof ClaimsUnavailableError) {
      if (env.ENVIRONMENT !== "production") {
        const dev = readDevChapters(request);
        if (dev) {
          claims = {
            sub: user.id,
            email: user.email,
            name: user.name,
            picture: user.image,
            emailVerified: true,
            isAdmin: Boolean(dev.isAdmin || user.isAdmin),
            chapter: dev.chapters[0] ?? null,
            chapters: dev.chapters,
          };
        } else {
          throw buildSignInRedirect(request);
        }
      } else {
        throw buildSignInRedirect(request);
      }
    } else {
      throw err;
    }
  }

  const isAdmin = Boolean(claims.isAdmin || isSuperAdmin(user));

  // Defensive parsing: discard any chapter entry where chapterId is not a safe integer number
  const validChapters: UserChapter[] = (claims.chapters ?? []).filter(
    (entry): entry is UserChapter =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.chapterId === "number" &&
      Number.isSafeInteger(entry.chapterId) &&
      typeof entry.chapterSlug === "string" &&
      (entry.role === "organizer" || entry.role === "member"),
  );

  const selectedId = options?.targetChapterId ?? readSelectedChapter(request);
  let chapter: UserChapter | null = null;
  let crossChapter = false;

  if (selectedId !== null) {
    const found = validChapters.find((c) => c.chapterId === selectedId);
    if (found) {
      chapter = found;
    } else if (isAdmin) {
      crossChapter = true;
      const cached = await getCachedChapter(env.DB, selectedId);
      chapter = {
        chapterId: selectedId,
        chapterSlug: cached?.slug ?? `chapter-${selectedId}`,
        role: "organizer",
      };
    }
  }

  if (!chapter) {
    if (validChapters.length > 0) {
      chapter = validChapters[0];
    } else if (isAdmin && selectedId !== null) {
      crossChapter = true;
      const cached = await getCachedChapter(env.DB, selectedId);
      chapter = {
        chapterId: selectedId,
        chapterSlug: cached?.slug ?? `chapter-${selectedId}`,
        role: "organizer",
      };
    } else {
      throw redirect("/no-chapter");
    }
  }

  // COND-603: Record audit log for admin cross-chapter access.
  // If recording fails, the entire operation must fail.
  if (crossChapter) {
    await recordAudit(env.DB, {
      actorUserId: user.id,
      actorRole: "is_admin",
      chapterId: chapter.chapterId,
      action: "chapter.cross_access",
      targetType: "chapter",
      targetId: String(chapter.chapterId),
    });
  }

  return {
    user,
    chapter,
    chapters: validChapters,
    isAdmin,
    crossChapter,
  };
}

/**
 * Enforce organizer permission (COND-602).
 * Admin passes unconditionally; members receive 403 Forbidden.
 */
export function requireOrganizer(access: ChapterAccess, chapterId?: number): void {
  if (access.isAdmin) return;
  const targetId = chapterId ?? access.chapter.chapterId;
  const membership = access.chapters.find((c) => c.chapterId === targetId);
  if (!membership || membership.role !== "organizer") {
    throw new Response("Forbidden", { status: 403 });
  }
}
