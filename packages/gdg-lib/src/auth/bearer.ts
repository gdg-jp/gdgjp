import { CHAPTERS_CLAIM, IS_ADMIN_CLAIM } from "./claims";
import type { AuthUser, ChapterRole, UserChapter } from "./index";

export type BearerIdentity = { user: AuthUser; chapters: UserChapter[] };

/**
 * Compatibility identity lookup: any valid OAuth client access token, resolved
 * through OIDC `/userinfo`. Malformed chapter entries are dropped individually
 * rather than failing the whole lookup — this leniency is part of the existing
 * authorization contract for connpass/wiki and must be preserved.
 */
export async function getBearerIdentity(
  request: Request,
  accountsUrl: string,
): Promise<BearerIdentity | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(new URL("/api/auth/oauth2/userinfo", accountsUrl), {
    headers: { authorization },
  });
  if (!response.ok) return null;
  const value = (await response.json()) as Record<string, unknown>;
  if (typeof value.sub !== "string" || !value.sub) return null;

  const chapters = Array.isArray(value[CHAPTERS_CLAIM])
    ? value[CHAPTERS_CLAIM].flatMap((entry) => {
        const chapter = parseChapter(entry);
        return chapter ? [chapter] : [];
      })
    : [];

  return {
    user: {
      id: value.sub,
      email: typeof value.email === "string" ? value.email : "",
      name: typeof value.name === "string" ? value.name : "",
      image: typeof value.picture === "string" ? value.picture : null,
      isAdmin: value[IS_ADMIN_CLAIM] === true,
    },
    chapters,
  };
}

/**
 * Strict CLI identity lookup: only a `gdg-cli` access token carrying the
 * `https://gdgs.jp/scopes/cli` scope succeeds. Backed by Accounts'
 * `/api/cli/v1/identity`, not `/userinfo`. A malformed Accounts response is an
 * integration failure — this returns `null` for the whole response rather than
 * dropping individual invalid entries.
 */
export async function getCliIdentity(
  request: Request,
  accountsUrl: string,
): Promise<BearerIdentity | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(new URL("/api/cli/v1/identity", accountsUrl), {
    headers: { authorization },
  });
  if (!response.ok) return null;

  const value = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return null;

  const user = parseStrictUser(value.user);
  if (!user) return null;

  if (!Array.isArray(value.chapters)) return null;
  const chapters: UserChapter[] = [];
  for (const entry of value.chapters) {
    const chapter = parseChapter(entry);
    if (!chapter) return null;
    chapters.push(chapter);
  }

  return { user, chapters };
}

function parseChapter(entry: unknown): UserChapter | null {
  if (!entry || typeof entry !== "object") return null;
  const chapter = entry as Record<string, unknown>;
  return typeof chapter.chapterId === "number" &&
    typeof chapter.chapterSlug === "string" &&
    isChapterRole(chapter.role)
    ? { chapterId: chapter.chapterId, chapterSlug: chapter.chapterSlug, role: chapter.role }
    : null;
}

function isChapterRole(value: unknown): value is ChapterRole {
  return value === "organizer" || value === "member";
}

function parseStrictUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  if (typeof user.id !== "string" || !user.id) return null;
  if (typeof user.email !== "string") return null;
  if (typeof user.name !== "string") return null;
  if (typeof user.image !== "string" && user.image !== null) return null;
  if (typeof user.isAdmin !== "boolean") return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    isAdmin: user.isAdmin,
  };
}
