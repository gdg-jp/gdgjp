import { redirect } from "react-router";
import type { AccessIdentity } from "~/features/auth/utils.server";
import type { getDb } from "~/lib/db.server";
import { getSpaceById, listAccessibleSpaces, requireSpace } from "./access.server";
import { type CurrentSpace, DEFAULT_CURRENT_SPACE } from "./components/current-space";
import { DEFAULT_SPACE_ID, spacePath } from "./shared";
import { type ViewerContext, loadViewerContext } from "./viewer.server";

type Db = ReturnType<typeof getDb>;

/**
 * Spaces for the app shell and the one it shows: the URL's, else the last visited,
 * else gdg-jp, else the first reachable one.
 */
export async function resolveShellSpaces(
  db: Db,
  viewer: ViewerContext,
  urlSpaceSlug: string | undefined,
): Promise<{ spaces: CurrentSpace[]; currentSpace: CurrentSpace }> {
  const spaces: CurrentSpace[] = (await listAccessibleSpaces(db, viewer.access)).map((space) => ({
    id: space.id,
    slug: space.slug,
    name: space.name,
    kind: space.kind as CurrentSpace["kind"],
    role: space.role,
  }));
  const currentSpace =
    (urlSpaceSlug ? spaces.find((space) => space.slug === urlSpaceSlug) : undefined) ??
    (viewer.lastSpaceId ? spaces.find((space) => space.id === viewer.lastSpaceId) : undefined) ??
    spaces.find((space) => space.id === DEFAULT_SPACE_ID) ??
    spaces[0] ??
    DEFAULT_CURRENT_SPACE;
  return { spaces, currentSpace };
}

/**
 * Scope of the home dashboard. `/s/:space` shows that space; `/` sends a signed-in user to
 * their last space (gdg-jp by default) and shows anonymous visitors gdg-jp's public pages.
 */
export async function resolveHomeScope(
  request: Request,
  env: Env,
  db: Db,
  identity: AccessIdentity,
  urlSpaceSlug: string | undefined,
): Promise<{ identity: AccessIdentity; spaceId: string; hideAgentPages: boolean }> {
  if (urlSpaceSlug) {
    const resolved = await requireSpace(request, env, urlSpaceSlug, "viewer", identity);
    const viewer = await loadViewerContext(request, env, resolved.identity);
    return {
      identity: resolved.identity,
      spaceId: resolved.space.id,
      hideAgentPages: viewer.hideAgentPages,
    };
  }
  if (identity.user) {
    const viewer = await loadViewerContext(request, env, identity);
    const last =
      viewer.lastSpaceId && viewer.access.has(viewer.lastSpaceId)
        ? await getSpaceById(db, viewer.lastSpaceId)
        : undefined;
    const fallback = viewer.access.has(DEFAULT_SPACE_ID)
      ? await getSpaceById(db, DEFAULT_SPACE_ID)
      : undefined;
    const target = last ?? fallback;
    if (target) throw redirect(spacePath(target.slug));
  }
  return { identity, spaceId: DEFAULT_SPACE_ID, hideAgentPages: false };
}
