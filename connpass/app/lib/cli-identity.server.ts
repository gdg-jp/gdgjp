import { CHAPTERS_CLAIM, IS_ADMIN_CLAIM } from "@gdgjp/gdg-lib/auth/claims";

/** Identity for a non-browser CLI request, obtained through OIDC userinfo. */
export type CliIdentity = {
  user: { id: string; email: string; name: string; image: string | null; isAdmin: boolean };
  chapters: Array<{ chapterId: string | number; chapterSlug: string; role: string }>;
};

export async function getCliIdentity(request: Request, env: Env): Promise<CliIdentity | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(new URL("/api/auth/oauth2/userinfo", env.ACCOUNTS_URL), {
    headers: { authorization },
  });
  if (!response.ok) return null;
  const value = (await response.json()) as Record<string, unknown>;
  if (typeof value.sub !== "string" || !value.sub) return null;

  const chapters = Array.isArray(value[CHAPTERS_CLAIM])
    ? value[CHAPTERS_CLAIM].flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const chapter = entry as Record<string, unknown>;
        return typeof chapter.chapterId === "number" &&
          typeof chapter.chapterSlug === "string" &&
          (chapter.role === "organizer" || chapter.role === "member")
          ? [{ chapterId: chapter.chapterId, chapterSlug: chapter.chapterSlug, role: chapter.role }]
          : [];
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
