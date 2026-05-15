import { type SQL, and, eq, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "~/db/schema";
import { pages } from "~/db/schema";
import { getUserPageRole } from "./page-access.server";

type UserLike = {
  id: string;
  isAdmin: boolean | null | undefined;
  email?: string | null;
};

type PageLike = {
  id?: string;
  visibility: string;
  chapterId?: string | null;
  authorId: string;
};

/**
 * Page-visibility decisions for the SSO-migrated wiki.
 *
 * Pre-migration this honored four visibilities — public, private_to_chapter,
 * private_to_lead, restricted — keyed off user.role and user.chapterId.
 * After moving user provisioning to the accounts IdP, wiki no longer stores
 * per-user chapter membership, so chapter-scoped visibilities collapse to
 * "author or admin only". Existing `pages.visibility` values are preserved
 * verbatim so the data is intact when/if richer scoping is reintroduced.
 */
export function canUserSeePage(user: UserLike, page: PageLike): boolean {
  if (user.isAdmin) return true;
  if (user.id === page.authorId) return true;
  if (page.visibility === "public") return true;
  // private_to_chapter / private_to_lead: chapter membership no longer
  // available locally; only author + admin (handled above) can see.
  // restricted: requires page_access lookup — handled by the async variant.
  return false;
}

/**
 * Async variant that handles "restricted" pages by checking page_access records.
 * For non-restricted pages falls back to the sync canUserSeePage.
 */
export async function canUserSeePageAsync(
  db: DrizzleD1Database<typeof schema>,
  user: UserLike,
  page: PageLike & { id: string },
): Promise<boolean> {
  if (page.visibility !== "restricted") return canUserSeePage(user, page);
  if (user.isAdmin) return true;
  if (user.id === page.authorId) return true;
  const role = await getUserPageRole(db, page.id, user.id, user.email);
  return role !== null;
}

export function canUserChangeVisibility(user: UserLike, page: PageLike): boolean {
  if (user.isAdmin) return true;
  if (user.id === page.authorId) return true;
  return false;
}

export function buildVisibilityFilter(user: UserLike): SQL | undefined {
  if (user.isAdmin) return undefined;

  const conditions: SQL[] = [eq(pages.authorId, user.id), eq(pages.visibility, "public")];

  // Restricted pages: visible if user has a page_access record.
  const restrictedMatch = and(
    eq(pages.visibility, "restricted"),
    sql`EXISTS (SELECT 1 FROM page_access WHERE page_id = ${pages.id}
      AND (user_id = ${user.id} OR email = ${user.email ?? ""}))`,
  );
  if (restrictedMatch) conditions.push(restrictedMatch);

  return or(...conditions);
}
