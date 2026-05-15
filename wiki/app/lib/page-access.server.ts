import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";

export type PageRole = "owner" | "editor" | "viewer";

export interface PageAccessEntry {
  id: string;
  pageId: string;
  email: string;
  userId: string | null;
  pageRole: PageRole;
  grantedBy: string;
  createdAt: number;
  updatedAt: number;
  userName: string | null;
  userImage: string | null;
}

type UserLike = {
  id: string;
  isAdmin: boolean | null | undefined;
  email?: string | null;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getPageAccessList(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
): Promise<PageAccessEntry[]> {
  const rows = await db
    .select({
      id: schema.pageAccess.id,
      pageId: schema.pageAccess.pageId,
      email: schema.pageAccess.email,
      userId: schema.pageAccess.userId,
      pageRole: schema.pageAccess.pageRole,
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

  return rows as PageAccessEntry[];
}

/**
 * Returns the page role for the given user on a specific page.
 * Also does lazy linking: if a record with null userId matches by email, updates userId.
 */
export async function getUserPageRole(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
  userId: string,
  email: string | null | undefined,
): Promise<PageRole | null> {
  // Try by userId first
  const byUser = await db
    .select({ id: schema.pageAccess.id, pageRole: schema.pageAccess.pageRole })
    .from(schema.pageAccess)
    .where(and(eq(schema.pageAccess.pageId, pageId), eq(schema.pageAccess.userId, userId)))
    .get();

  if (byUser) return byUser.pageRole as PageRole;

  // Fallback: try by email with null userId (pending record)
  if (!email) return null;

  const byEmail = await db
    .select({ id: schema.pageAccess.id, pageRole: schema.pageAccess.pageRole })
    .from(schema.pageAccess)
    .where(
      and(
        eq(schema.pageAccess.pageId, pageId),
        eq(schema.pageAccess.email, email),
        isNull(schema.pageAccess.userId),
      ),
    )
    .get();

  if (!byEmail) return null;

  // Lazy link: update userId now that we know it
  await db
    .update(schema.pageAccess)
    .set({ userId, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.pageAccess.id, byEmail.id));

  return byEmail.pageRole as PageRole;
}

export async function canUserManageAccess(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
  user: UserLike,
  pageAuthorId?: string,
): Promise<boolean> {
  if (user.isAdmin) return true;
  if (pageAuthorId && user.id === pageAuthorId) return true;
  const role = await getUserPageRole(db, pageId, user.id, user.email);
  return role === "owner" || role === "editor";
}

// ---------------------------------------------------------------------------
// Permission checks (synchronous)
// ---------------------------------------------------------------------------

export function canUserGrantRole(
  granterPageRole: PageRole | null,
  granterIsAdmin: boolean | null | undefined,
  targetRole: PageRole,
): boolean {
  if (granterIsAdmin) return true;
  if (granterPageRole === "owner") return true;
  if (granterPageRole === "editor") return targetRole !== "owner";
  return false;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function upsertPageAccess(
  db: DrizzleD1Database<typeof schema>,
  opts: {
    pageId: string;
    email: string;
    pageRole: PageRole;
    grantedBy: string;
    userId?: string | null;
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Look up userId by email if not provided
  let resolvedUserId = opts.userId ?? null;
  if (resolvedUserId === null) {
    const u = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, opts.email))
      .get();
    resolvedUserId = u?.id ?? null;
  }

  // Check if record exists (by pageId + email)
  const existing = await db
    .select({ id: schema.pageAccess.id })
    .from(schema.pageAccess)
    .where(and(eq(schema.pageAccess.pageId, opts.pageId), eq(schema.pageAccess.email, opts.email)))
    .get();

  if (existing) {
    await db
      .update(schema.pageAccess)
      .set({ pageRole: opts.pageRole, userId: resolvedUserId, updatedAt: now })
      .where(eq(schema.pageAccess.id, existing.id));
  } else {
    await db.insert(schema.pageAccess).values({
      id: nanoid(),
      pageId: opts.pageId,
      email: opts.email,
      userId: resolvedUserId,
      pageRole: opts.pageRole,
      grantedBy: opts.grantedBy,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function removePageAccess(
  db: DrizzleD1Database<typeof schema>,
  accessId: string,
  pageId: string,
): Promise<{ ok: boolean; error?: "last_owner" }> {
  // Check if target is an owner
  const target = await db
    .select({ pageRole: schema.pageAccess.pageRole })
    .from(schema.pageAccess)
    .where(eq(schema.pageAccess.id, accessId))
    .get();

  if (!target) return { ok: false };

  if (target.pageRole === "owner") {
    // Count remaining owners
    const owners = await db
      .select({ id: schema.pageAccess.id })
      .from(schema.pageAccess)
      .where(and(eq(schema.pageAccess.pageId, pageId), eq(schema.pageAccess.pageRole, "owner")))
      .all();

    if (owners.length <= 1) {
      return { ok: false, error: "last_owner" };
    }
  }

  await db.delete(schema.pageAccess).where(eq(schema.pageAccess.id, accessId));
  return { ok: true };
}

/**
 * Inserts the page author as owner. Idempotent — uses INSERT OR IGNORE semantics
 * via onConflictDoNothing.
 */
export async function insertPageOwner(
  db: DrizzleD1Database<typeof schema>,
  pageId: string,
  authorId: string,
  authorEmail: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(schema.pageAccess)
    .values({
      id: nanoid(),
      pageId,
      email: authorEmail,
      userId: authorId,
      pageRole: "owner",
      grantedBy: authorId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}
