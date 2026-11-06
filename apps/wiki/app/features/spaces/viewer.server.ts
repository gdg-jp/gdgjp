import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { type AccessIdentity, getAccessIdentity } from "~/features/auth/utils.server";
import { getDb } from "~/lib/db.server";
import { type SpaceAccess, resolveSpaceAccess } from "./access.server";

export type ViewerContext = {
  identity: AccessIdentity;
  access: SpaceAccess;
  visibleSpaceIds: string[];
  hideAgentPages: boolean;
  lastSpaceId: string | null;
};

/** Identity + reachable spaces + display preferences for listing screens. */
export async function loadViewerContext(
  request: Request,
  env: Env,
  identity?: AccessIdentity,
): Promise<ViewerContext> {
  const db = getDb(env);
  const resolvedIdentity = identity ?? (await getAccessIdentity(request, env));
  const [access, prefs] = await Promise.all([
    resolveSpaceAccess(db, resolvedIdentity),
    resolvedIdentity.user
      ? db
          .select({
            hideAgentPages: schema.userPreferences.hideAgentPages,
            lastSpaceId: schema.userPreferences.lastSpaceId,
          })
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, resolvedIdentity.user.id))
          .get()
      : Promise.resolve(undefined),
  ]);
  return {
    identity: resolvedIdentity,
    access,
    visibleSpaceIds: [...access.keys()],
    hideAgentPages: prefs?.hideAgentPages ?? false,
    lastSpaceId: prefs?.lastSpaceId ?? null,
  };
}

export async function rememberLastSpace(env: Env, userId: string, spaceId: string): Promise<void> {
  await getDb(env)
    .insert(schema.userPreferences)
    .values({ userId, lastSpaceId: spaceId })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: { lastSpaceId: spaceId },
    })
    .run();
}

export async function setHideAgentPages(env: Env, userId: string, hide: boolean): Promise<void> {
  await getDb(env)
    .insert(schema.userPreferences)
    .values({ userId, hideAgentPages: hide })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: { hideAgentPages: hide },
    })
    .run();
}
