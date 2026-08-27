import { type AuthUser, getCliIdentity, isSuperAdmin } from "@gdgjp/gdg-lib";
import { isContributor } from "~/features/contributors/contributor.repository.server";

/**
 * CLI equivalent of {@link import("~/lib/access.server").requireSnsAccess}, but
 * for a JSON API: it returns a discriminated result instead of throwing
 * `redirect()`/`Response`. A route turns `{ error: 401 }` / `{ error: 403 }`
 * into the matching JSON status; an id-addressed route turns `403` into `404`
 * so callers cannot enumerate ids across chapters.
 *
 * A `gdg-cli` identity only ever carries `organizer`/`member` chapter roles;
 * contributor access is granted by the `sns_contributors` table, exactly as the
 * live `requireSnsAccess` check works.
 */
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

/**
 * Organizer or contributor access to `chapterId` — the surface for post/media
 * CRUD and X-account discovery/revocation.
 */
export async function requireCliSnsAccess(
  request: Request,
  env: Env,
  chapterId: number,
): Promise<CliSnsAccess> {
  return resolveAccess(request, env, chapterId);
}

/**
 * Organizer-only access to `chapterId` — the surface for contributor
 * administration. Being a contributor never grants contributor administration.
 */
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
