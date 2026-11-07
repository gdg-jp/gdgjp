import type { UserChapter } from "@gdgjp/gdg-lib";

/** The chapter the sidebar shows. Every list (events, notifications, contacts, settings) uses it. */
export const CHAPTER_COOKIE = "gdgjp-pr-chapter";

/** The cookie's chapter if the user is still in it, otherwise the first membership. */
export function pickChapter(
  cookieHeader: string | null,
  chapters: UserChapter[],
): UserChapter | null {
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CHAPTER_COOKIE}=`))
    ?.slice(CHAPTER_COOKIE.length + 1);
  const id = Number(raw);
  return chapters.find((c) => c.chapterId === id) ?? chapters[0] ?? null;
}

export function chapterCookie(chapterId: number, secure: boolean): string {
  return `${CHAPTER_COOKIE}=${chapterId}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** "gdg-kwansai" → "GDG Kwansai". The slug is all Accounts gives us. */
export function chapterLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => (w === "gdg" ? "GDG" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
