import { type AuthUser, type UserChapter, isSuperAdmin } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { isContributor } from "~/features/contributors/contributor.repository.server";
import { getAuth } from "~/lib/auth.server";
import { listAccessibleChapters } from "~/lib/db.server";
import { safeReturnTo } from "~/lib/utils";

const CHAPTER_COOKIE = "sns-chapter";

export function buildSignInRedirect(request: Request): Response {
  const url = new URL(request.url);
  return redirect(`/signin?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
}

function readSelectedChapter(request: Request): number | null {
  const match = request.headers
    .get("Cookie")
    ?.match(new RegExp(`(?:^|; )${CHAPTER_COOKIE}=([^;]+)`));
  const parsed = Number(match?.[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function chapterCookie(chapterId: number): string {
  return `${CHAPTER_COOKIE}=${chapterId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`;
}

export async function requireSnsAccess(
  env: Env,
  request: Request,
): Promise<{
  user: AuthUser;
  chapter: { chapterId: number; chapterSlug: string; role: "organizer" | "member" | "contributor" };
  chapters: {
    chapterId: number;
    chapterSlug: string;
    role: "organizer" | "member" | "contributor";
  }[];
}> {
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(request);
  } catch {
    throw buildSignInRedirect(request);
  }
  let memberships: UserChapter[];
  try {
    memberships = (await getAuth(env).getFreshClaims(request)).chapters;
  } catch {
    throw buildSignInRedirect(request);
  }
  const superAdmin = isSuperAdmin(user);
  const chapters = await listAccessibleChapters(env.DB, user.email, memberships, superAdmin);
  if (chapters.length === 0) throw redirect("/no-chapter");
  const selectedId = readSelectedChapter(request);
  const chapter = chapters.find((item) => item.chapterId === selectedId) ?? chapters[0];
  if (!chapter) throw redirect("/no-chapter");
  const permitted =
    chapter.role === "organizer" ||
    superAdmin ||
    (await isContributor(env.DB, chapter.chapterId, user.email));
  if (!permitted) throw new Response("Forbidden", { status: 403 });
  return { user, chapter, chapters };
}

export { safeReturnTo };
