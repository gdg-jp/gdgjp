import { and, eq, inArray, or } from "drizzle-orm";
import * as schema from "~/db/schema";
import { type AccessIdentity, getAccessIdentity } from "~/features/auth/utils.server";
import { getDb } from "~/lib/db.server";
import { type SpaceKind, type SpaceRole, isSpaceRole, roleAtLeast, strongerRole } from "./shared";

type Db = ReturnType<typeof getDb>;

export type SpaceAccess = ReadonlyMap<string, SpaceRole>;

/** Identity fields the resolver reads. Accepts browser sessions and Bearer identities. */
export type SpaceIdentity = {
  user: { id: string; isAdmin?: boolean } | null;
  chapters: readonly { chapterId: string | number; role: string }[];
  claimsAvailable: boolean;
};

export type ExtraPrincipal = { type: "discord_guild" | "chat_space"; id: string };

export type SpaceRow = typeof schema.spaces.$inferSelect;

/** Keys a chapter membership matches: exact chapter and wildcard; organizer implies member. */
export function chapterPrincipalKeys(chapters: SpaceIdentity["chapters"]): string[] {
  const keys = new Set<string>();
  for (const chapter of chapters) {
    const id = String(chapter.chapterId);
    const roles = chapter.role === "organizer" ? ["organizer", "member"] : [chapter.role];
    for (const role of roles) {
      if (role !== "organizer" && role !== "member") continue;
      keys.add(`${id}:${role}`);
      keys.add(`*:${role}`);
    }
  }
  return [...keys];
}

/**
 * Resolve the caller's role in every space they can reach. This is the OUTER layer only:
 * callers must still run the inner ACL (canAccessSource / getEffectivePagePermissions /
 * redactPageMarkdown) on anything inside the space.
 */
export async function resolveSpaceAccess(
  db: Db,
  identity: SpaceIdentity,
  extraPrincipals: readonly ExtraPrincipal[] = [],
): Promise<SpaceAccess> {
  const access = new Map<string, SpaceRole>();
  if (identity.user?.isAdmin) {
    const rows = await db.select({ id: schema.spaces.id }).from(schema.spaces).all();
    for (const row of rows) access.set(row.id, "owner");
    return access;
  }

  const m = schema.spaceMembers;
  const conditions = [eq(m.principalType, "public")];
  if (identity.user) {
    conditions.push(
      and(eq(m.principalType, "user"), inArray(m.principalId, [identity.user.id, "*"])) ??
        eq(m.principalType, "user"),
    );
  }
  // Fail closed: without fresh claims, chapter-derived membership is not evaluated.
  const chapterKeys = identity.claimsAvailable ? chapterPrincipalKeys(identity.chapters) : [];
  if (chapterKeys.length > 0) {
    conditions.push(
      and(eq(m.principalType, "chapter_role"), inArray(m.principalId, chapterKeys)) ??
        eq(m.principalType, "chapter_role"),
    );
  }
  for (const type of ["discord_guild", "chat_space"] as const) {
    const ids = extraPrincipals.filter((p) => p.type === type).map((p) => p.id);
    if (ids.length > 0) {
      conditions.push(
        and(eq(m.principalType, type), inArray(m.principalId, ids)) ?? eq(m.principalType, type),
      );
    }
  }

  const rows = await db
    .select({ spaceId: m.spaceId, role: m.role })
    .from(m)
    .where(or(...conditions))
    .all();
  for (const row of rows) {
    if (!isSpaceRole(row.role)) continue;
    // Anonymous visitors only ever get the public viewer role.
    access.set(row.spaceId, strongerRole(access.get(row.spaceId), row.role));
  }
  return access;
}

export async function getSpaceBySlug(db: Db, slug: string): Promise<SpaceRow | undefined> {
  return db.select().from(schema.spaces).where(eq(schema.spaces.slug, slug)).get();
}

export async function getSpaceById(db: Db, id: string): Promise<SpaceRow | undefined> {
  return db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
}

export type ResolvedSpace = {
  space: SpaceRow & { kind: SpaceKind };
  role: SpaceRole;
  identity: AccessIdentity;
  access: SpaceAccess;
};

/**
 * Route guard: the space must exist and the caller must hold at least `minRole`.
 * Missing and forbidden spaces are both 404 so the URL is not an existence oracle.
 * Call this BEFORE the inner ACL (enforced by tests/architecture/space-before-inner-acl).
 */
export async function requireSpace(
  request: Request,
  env: Env,
  spaceSlug: string | undefined,
  minRole: SpaceRole = "viewer",
  identity?: AccessIdentity,
): Promise<ResolvedSpace> {
  const db = getDb(env);
  const resolvedIdentity = identity ?? (await getAccessIdentity(request, env));
  const space = spaceSlug ? await getSpaceBySlug(db, spaceSlug) : undefined;
  if (!space) throw new Response("Not Found", { status: 404 });
  const access = await resolveSpaceAccess(db, resolvedIdentity);
  const role = access.get(space.id);
  if (!roleAtLeast(role, "viewer")) throw new Response("Not Found", { status: 404 });
  if (!roleAtLeast(role, minRole)) throw new Response("Forbidden", { status: 403 });
  return {
    space: space as SpaceRow & { kind: SpaceKind },
    role: role as SpaceRole,
    identity: resolvedIdentity,
    access,
  };
}

/** Spaces the caller can view, in name order, with their role. */
export async function listAccessibleSpaces(
  db: Db,
  access: SpaceAccess,
): Promise<Array<SpaceRow & { role: SpaceRole }>> {
  const ids = [...access.keys()];
  if (ids.length === 0) return [];
  const rows = await db.select().from(schema.spaces).where(inArray(schema.spaces.id, ids)).all();
  return rows
    .map((row) => ({ ...row, role: access.get(row.id) as SpaceRole }))
    .sort((a, b) =>
      a.id === "gdg-jp" ? -1 : b.id === "gdg-jp" ? 1 : a.name.localeCompare(b.name, "ja"),
    );
}

/** Whether anonymous visitors may reach the space (it has the `public` viewer principal). */
export async function isSpacePublic(db: Db, spaceId: string): Promise<boolean> {
  const row = await db
    .select({ id: schema.spaceMembers.spaceId })
    .from(schema.spaceMembers)
    .where(
      and(
        eq(schema.spaceMembers.spaceId, spaceId),
        eq(schema.spaceMembers.principalType, "public"),
      ),
    )
    .get();
  return !!row;
}

/**
 * Outer-layer check for routes addressed by page id (comments, sharing, favorites…).
 * Returns the page's space and the caller's role, or throws 404 when the caller cannot
 * reach that space. Call before the inner page ACL.
 */
export async function requirePageSpace(
  db: Db,
  identity: SpaceIdentity,
  pageId: string,
  minRole: SpaceRole = "viewer",
): Promise<{ spaceId: string; role: SpaceRole }> {
  const row = await db
    .select({ spaceId: schema.pages.spaceId })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();
  if (!row) throw new Response("Not Found", { status: 404 });
  const role = (await resolveSpaceAccess(db, identity)).get(row.spaceId);
  if (!roleAtLeast(role, "viewer")) throw new Response("Not Found", { status: 404 });
  if (!roleAtLeast(role, minRole)) throw new Response("Forbidden", { status: 403 });
  return { spaceId: row.spaceId, role: role as SpaceRole };
}

/** Outer-layer check for routes addressed by source id. Same contract as requirePageSpace. */
export async function requireSourceSpace(
  db: Db,
  identity: SpaceIdentity,
  sourceId: string,
  minRole: SpaceRole = "viewer",
): Promise<{ spaceId: string; role: SpaceRole }> {
  const row = await db
    .select({ spaceId: schema.sources.spaceId })
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (!row) throw new Response("Not Found", { status: 404 });
  const role = (await resolveSpaceAccess(db, identity)).get(row.spaceId);
  if (!roleAtLeast(role, "viewer")) throw new Response("Not Found", { status: 404 });
  if (!roleAtLeast(role, minRole)) throw new Response("Forbidden", { status: 403 });
  return { spaceId: row.spaceId, role: role as SpaceRole };
}

/**
 * `requireSpace` for callers that already hold an identity (Bearer tokens for the CLI /
 * agent APIs). Missing and forbidden spaces are both 404.
 */
export async function requireSpaceForIdentity(
  db: Db,
  identity: SpaceIdentity,
  spaceSlug: string,
  minRole: SpaceRole = "viewer",
): Promise<{ space: SpaceRow & { kind: SpaceKind }; role: SpaceRole }> {
  const space = await getSpaceBySlug(db, spaceSlug);
  if (!space) throw new Response("Not Found", { status: 404 });
  const role = (await resolveSpaceAccess(db, identity)).get(space.id);
  if (!roleAtLeast(role, "viewer")) throw new Response("Not Found", { status: 404 });
  if (!roleAtLeast(role, minRole)) throw new Response("Forbidden", { status: 403 });
  return { space: space as SpaceRow & { kind: SpaceKind }, role: role as SpaceRole };
}
