import { and, eq, inArray, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";

export type GeneralAccess = "restricted" | "unlisted" | "public";
export type PageRole = "viewer" | "commenter" | "editor";
export type EffectivePageRole = "owner" | PageRole | null;
export type ShareSubjectType = "email" | "chapter";
export type PermissionSource = "owner" | "admin" | "email" | "chapter" | "general" | null;

export type ShareSubject = {
  subjectType: ShareSubjectType;
  subjectKey: string;
  subjectLabel: string;
  userId?: string | null;
};

export interface PageAccessEntry extends ShareSubject {
  id: string;
  pageId: string;
  role: PageRole;
  /** @deprecated use role */
  pageRole: PageRole;
  grantedBy: string;
  createdAt: number;
  updatedAt: number;
  userName: string | null;
  userImage: string | null;
}

export interface EffectivePagePermissions {
  role: EffectivePageRole;
  canView: boolean;
  canComment: boolean;
  canEdit: boolean;
  canManageSharing: boolean;
  source: PermissionSource;
}

export type PagePermissionSubject = {
  id: string;
  authorId: string;
  visibility: string;
  generalRole?: string | null;
};

type UserLike = {
  id: string;
  isAdmin: boolean | null | undefined;
  email?: string | null;
};

const ROLE_RANK: Record<Exclude<EffectivePageRole, null>, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

export function isPageRole(value: unknown): value is PageRole {
  return value === "viewer" || value === "commenter" || value === "editor";
}

export function isGeneralAccess(value: unknown): value is GeneralAccess {
  return value === "restricted" || value === "unlisted" || value === "public";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

function maxRole(roles: PageRole[]): PageRole | null {
  return roles.reduce<PageRole | null>((current, role) => {
    if (!current || ROLE_RANK[role] > ROLE_RANK[current]) return role;
    return current;
  }, null);
}

// ---------------------------------------------------------------------------
// Queries and permission evaluation
// ---------------------------------------------------------------------------

export async function getPageAccessList(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
): Promise<PageAccessEntry[]> {
  const rows = await db
    .select({
      id: schema.pageAccess.id,
      pageId: schema.pageAccess.pageId,
      subjectType: schema.pageAccess.subjectType,
      subjectKey: schema.pageAccess.subjectKey,
      subjectLabel: schema.pageAccess.subjectLabel,
      userId: schema.pageAccess.userId,
      role: schema.pageAccess.role,
      grantedBy: schema.pageAccess.grantedBy,
      createdAt: schema.pageAccess.createdAt,
      updatedAt: schema.pageAccess.updatedAt,
      userName: schema.user.name,
      userImage: schema.user.image,
    })
    .from(schema.pageAccess)
    .leftJoin(schema.user, eq(schema.pageAccess.userId, schema.user.id))
    .where(eq(schema.pageAccess.pageId, pageId))
    .all();

  return rows.map((row) => ({
    ...row,
    subjectType: row.subjectType as ShareSubjectType,
    role: row.role as PageRole,
    pageRole: row.role as PageRole,
  }));
}

/** Returns the grants that explicitly apply to this signed-in user. */
export async function getExplicitPageRoles(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
  user: UserLike | null,
  chapterIds: readonly (string | number)[] = [],
): Promise<
  Array<{ role: PageRole; source: Exclude<PermissionSource, "owner" | "admin" | "general" | null> }>
> {
  if (!user) return [];
  const email = user.email ? normalizeEmail(user.email) : null;
  const chapterKeys = [...new Set(chapterIds.map(String))];
  const subjects = [];

  if (email) {
    subjects.push(
      and(
        eq(schema.pageAccess.subjectType, "email"),
        or(eq(schema.pageAccess.subjectKey, email), eq(schema.pageAccess.userId, user.id)),
      ),
    );
  } else {
    subjects.push(eq(schema.pageAccess.userId, user.id));
  }
  if (chapterKeys.length > 0) {
    subjects.push(
      and(
        eq(schema.pageAccess.subjectType, "chapter"),
        inArray(schema.pageAccess.subjectKey, chapterKeys),
      ),
    );
  }

  const rows = await db
    .select({ subjectType: schema.pageAccess.subjectType, role: schema.pageAccess.role })
    .from(schema.pageAccess)
    .where(and(eq(schema.pageAccess.pageId, pageId), or(...subjects)))
    .all();

  return rows.flatMap((row) =>
    isPageRole(row.role) && (row.subjectType === "email" || row.subjectType === "chapter")
      ? [{ role: row.role, source: row.subjectType }]
      : [],
  );
}

/**
 * Central page permission evaluator. Callers fetch fresh chapter claims before
 * passing chapterIds; on a claims failure pass no chapter IDs (fail closed).
 */
export async function getEffectivePagePermissions(
  db: DrizzleD1Database<typeof schema>,
  page: PagePermissionSubject,
  user: UserLike | null,
  chapterIds: readonly (string | number)[] = [],
): Promise<EffectivePagePermissions> {
  // These implicit grants do not depend on stored share rows. Avoiding the
  // query also keeps owner/admin authorization available if D1 is degraded.
  if (!user || user.isAdmin || user.id === page.authorId) {
    return evaluatePagePermissions(page, user);
  }
  const explicit = await getExplicitPageRoles(db, page.id, user, chapterIds);
  return evaluatePagePermissions(page, user, explicit);
}

/** Pure form of the evaluator, useful for focused policy tests. */
export function evaluatePagePermissions(
  page: PagePermissionSubject,
  user: UserLike | null,
  explicit: Array<{
    role: PageRole;
    source: Exclude<PermissionSource, "owner" | "admin" | "general" | null>;
  }> = [],
): EffectivePagePermissions {
  if (user?.isAdmin) {
    return {
      role: "owner",
      canView: true,
      canComment: true,
      canEdit: true,
      canManageSharing: true,
      source: "admin",
    };
  }
  if (user?.id === page.authorId) {
    return {
      role: "owner",
      canView: true,
      canComment: true,
      canEdit: true,
      canManageSharing: true,
      source: "owner",
    };
  }

  const explicitRole = maxRole(explicit.map((entry) => entry.role));
  const explicitSource = explicitRole
    ? (explicit.find((entry) => entry.role === explicitRole)?.source ?? null)
    : null;
  const generalRole = isPageRole(page.generalRole) ? page.generalRole : "viewer";
  const hasGeneralAccess = page.visibility === "unlisted" || page.visibility === "public";

  // Anonymous visitors are intentionally read-only even when a general role is
  // configured as commenter/editor.
  if (!user) {
    return {
      role: hasGeneralAccess ? "viewer" : null,
      canView: hasGeneralAccess,
      canComment: false,
      canEdit: false,
      canManageSharing: false,
      source: hasGeneralAccess ? "general" : null,
    };
  }

  const generalCandidate = hasGeneralAccess ? generalRole : null;
  const role = maxRole([
    ...(explicitRole ? [explicitRole] : []),
    ...(generalCandidate ? [generalCandidate] : []),
  ]);
  const source =
    role &&
    explicitRole &&
    ROLE_RANK[explicitRole] >= (generalCandidate ? ROLE_RANK[generalCandidate] : 0)
      ? explicitSource
      : role
        ? "general"
        : null;

  return {
    role,
    canView: role !== null,
    canComment: role === "commenter" || role === "editor",
    canEdit: role === "editor",
    // General access never authorizes sharing. An explicit editor grant does.
    canManageSharing: explicit.some((entry) => entry.role === "editor"),
    source,
  };
}

/** Legacy convenience helper for direct email/user grants only. */
export async function getUserPageRole(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
  userId: string,
  email: string | null | undefined,
): Promise<PageRole | null> {
  const roles = await getExplicitPageRoles(db, pageId, { id: userId, isAdmin: false, email });
  return maxRole(roles.filter((entry) => entry.source === "email").map((entry) => entry.role));
}

export async function canUserManageAccess(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
  user: UserLike,
  pageAuthorId?: string,
  chapterIds: readonly (string | number)[] = [],
): Promise<boolean> {
  if (user.isAdmin || (pageAuthorId && user.id === pageAuthorId)) return true;
  const explicit = await getExplicitPageRoles(db, pageId, user, chapterIds);
  return explicit.some((entry) => entry.role === "editor");
}

/** Editors may manage sharing but cannot create an owner, because owners are implicit. */
export function canUserGrantRole(
  granterPageRole: EffectivePageRole,
  granterIsAdmin: boolean | null | undefined,
  targetRole: PageRole,
): boolean {
  return (
    Boolean(granterIsAdmin || granterPageRole === "owner" || granterPageRole === "editor") &&
    isPageRole(targetRole)
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function upsertPageAccess(
  db: DrizzleD1Database<typeof schema>,
  opts: ShareSubject & { pageId: string; role: PageRole; grantedBy: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const subjectKey =
    opts.subjectType === "email" ? normalizeEmail(opts.subjectKey) : opts.subjectKey;
  let userId = opts.userId ?? null;
  if (opts.subjectType === "email" && !userId) {
    const found = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, subjectKey))
      .get();
    userId = found?.id ?? null;
  }
  const existing = await db
    .select({ id: schema.pageAccess.id })
    .from(schema.pageAccess)
    .where(
      and(
        eq(schema.pageAccess.pageId, opts.pageId),
        eq(schema.pageAccess.subjectType, opts.subjectType),
        eq(schema.pageAccess.subjectKey, subjectKey),
      ),
    )
    .get();

  if (existing) {
    await db
      .update(schema.pageAccess)
      .set({
        subjectLabel: opts.subjectLabel,
        userId,
        role: opts.role,
        grantedBy: opts.grantedBy,
        updatedAt: now,
      })
      .where(eq(schema.pageAccess.id, existing.id));
    return;
  }

  await db.insert(schema.pageAccess).values({
    id: nanoid(),
    pageId: opts.pageId,
    subjectType: opts.subjectType,
    subjectKey,
    subjectLabel: opts.subjectLabel,
    userId,
    role: opts.role,
    grantedBy: opts.grantedBy,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updatePageAccessRole(
  db: DrizzleD1Database<typeof schema>,
  accessId: string,
  pageId: string,
  role: PageRole,
  grantedBy: string,
): Promise<boolean> {
  const target = await db
    .select({ id: schema.pageAccess.id })
    .from(schema.pageAccess)
    .where(and(eq(schema.pageAccess.id, accessId), eq(schema.pageAccess.pageId, pageId)))
    .get();
  if (!target) return false;
  await db
    .update(schema.pageAccess)
    .set({ role, grantedBy, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.pageAccess.id, accessId));
  return true;
}

export async function removePageAccess(
  db: DrizzleD1Database<typeof schema>,
  accessId: string,
  pageId: string,
): Promise<{ ok: boolean }> {
  const target = await db
    .select({ id: schema.pageAccess.id })
    .from(schema.pageAccess)
    .where(and(eq(schema.pageAccess.id, accessId), eq(schema.pageAccess.pageId, pageId)))
    .get();
  if (!target) return { ok: false };
  await db.delete(schema.pageAccess).where(eq(schema.pageAccess.id, accessId));
  return { ok: true };
}

/** Kept as a harmless migration shim for old page-creation callers. */
export async function insertPageOwner(
  _db: DrizzleD1Database<typeof schema>,
  _pageId: string,
  _authorId: string,
  _authorEmail: string,
): Promise<void> {}
