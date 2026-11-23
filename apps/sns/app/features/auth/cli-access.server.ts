import { type AuthUser, getCliIdentity, isSuperAdmin } from "@gdgjp/gdg-lib";
import { isContributor } from "~/features/contributors/contributor.repository.server";

export type CliSnsAccess =
  | { user: AuthUser; role: "organizer" | "member" | "contributor" }
  | { error: 401 | 403 };

async function resolveAccess(
  request: Request,
  env: Env,
  chapterId: number,
): Promise<{ user: AuthUser; role: "organizer" | "contributor" } | { error: 401 | 403 }> {
  const identity = await getCliIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return { error: 401 };

  const membership = identity.chapters.find((chapter) => chapter.chapterId === chapterId);
  if (membership?.role === "organizer" || isSuperAdmin(identity.user)) {
    return { user: identity.user, role: "organizer" };
  }
  if (await isContributor(env.DB, chapterId, identity.user.email)) {
    return { user: identity.user, role: "contributor" };
  }
  return { error: 403 };
}

export async function requireCliSnsAccess(
  request: Request,
  env: Env,
  chapterId: number,
): Promise<CliSnsAccess> {
  return resolveAccess(request, env, chapterId);
}

export async function requireCliSnsOrganizer(
  request: Request,
  env: Env,
  chapterId: number,
): Promise<{ user: AuthUser } | { error: 401 | 403 }> {
  const identity = await getCliIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return { error: 401 };
  const membership = identity.chapters.find((chapter) => chapter.chapterId === chapterId);
  if (membership?.role === "organizer" || isSuperAdmin(identity.user)) {
    return { user: identity.user };
  }
  return { error: 403 };
}
