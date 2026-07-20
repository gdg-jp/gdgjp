export type AuthUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  isAdmin: boolean;
};

export type ChapterRole = "organizer" | "member";

export type UserChapter = {
  chapterId: number;
  chapterSlug: string;
  role: ChapterRole;
};

export type UserClaims = {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  chapter: UserChapter | null;
  /** All active memberships. The singular `chapter` field is the "primary"
   * (organizer beats member, then oldest approved). New consumers should
   * prefer `chapters`; legacy consumers continue to read `chapter`. */
  chapters: UserChapter[];
};

export const SSO_PROVIDER_ID = "gdgjp";
export const CHAPTERS_SCOPE = "https://gdgs.jp/scopes/chapters";
export const CHAPTERS_CLAIM = "https://gdgs.jp/claims/chapters";
export const IS_ADMIN_CLAIM = "https://gdgs.jp/claims/is_admin";

export function isSuperAdmin(user: AuthUser): boolean {
  return user.isAdmin;
}

export class ClaimsUnavailableError extends Error {
  constructor(
    public readonly reason: "no_linked_account" | "refresh_failed" | "userinfo_failed",
    cause?: unknown,
  ) {
    super(`claims unavailable: ${reason}`);
    this.name = "ClaimsUnavailableError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export type SessionApi = {
  api: {
    getSession: (args: { headers: Headers }) => Promise<{
      user: Record<string, unknown>;
    } | null>;
  };
};

export async function getSessionUser(auth: SessionApi, request: Request): Promise<AuthUser | null> {
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result?.user) return null;
  return mapToAuthUser(result.user);
}

export async function requireUser(auth: SessionApi, request: Request): Promise<AuthUser> {
  const user = await getSessionUser(auth, request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

function mapToAuthUser(user: Record<string, unknown>): AuthUser {
  return {
    id: String(user.id ?? ""),
    email: String(user.email ?? ""),
    name: String(user.name ?? ""),
    image: typeof user.image === "string" ? user.image : null,
    isAdmin: user.isAdmin === true || user.isAdmin === 1,
  };
}
