import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import type { PageRole, ShareSubject } from "./access-types";
import { normalizeEmail } from "./access-types";

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
