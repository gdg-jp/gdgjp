import { type SQL, and, eq, ne, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "~/db/schema";
import { pages } from "~/db/schema";
import { getEffectivePagePermissions } from "./page-access.server";

type UserLike = {
  id: string;
  isAdmin: boolean | null | undefined;
  email?: string | null;
};

export type PageLike = {
  id?: string;
  visibility: string;
  generalRole?: string | null;
  authorId: string;
};

/**
 * Fast direct-access check for pages that do not require an explicit grant.
 * Restricted grants are resolved by the async evaluator below.
 */
export function canUserSeePage(user: UserLike | null, page: PageLike): boolean {
  if (user?.isAdmin || (user && user.id === page.authorId)) return true;
  return page.visibility === "public" || page.visibility === "unlisted";
}

export async function canUserSeePageAsync(
  db: DrizzleD1Database<typeof schema>,
  user: UserLike | null,
  page: PageLike & { id: string },
  chapterIds: readonly (string | number)[] = [],
): Promise<boolean> {
  if (canUserSeePage(user, page)) return true;
  const permissions = await getEffectivePagePermissions(db, page, user, chapterIds);
  return permissions.canView;
}

/**
 * Visibility filter for discoverable surfaces (home, sidebar, search, recent).
 * Unlisted pages are intentionally absent even for their owner; they are only
 * reachable by their direct URL.
 */
export function buildVisibilityFilter(
  user: UserLike | null,
  chapterIds: readonly (string | number)[] = [],
): SQL {
  if (!user) return eq(pages.visibility, "public");
  if (user.isAdmin) return ne(pages.visibility, "unlisted");

  const normalizedEmail = user.email?.trim().toLowerCase() ?? "";
  const chapterKeys = chapterIds.map(String);
  const chapterSql =
    chapterKeys.length > 0
      ? sql` OR (subject_type = 'chapter' AND subject_key IN (${sql.join(
          chapterKeys.map((id) => sql`${id}`),
          sql`, `,
        )}))`
      : sql``;

  const restrictedGrant = sql`(
    ${pages.visibility} = 'restricted'
    AND EXISTS (
      SELECT 1 FROM page_access
      WHERE page_id = ${pages.id}
        AND ((subject_type = 'email' AND subject_key = ${normalizedEmail})${chapterSql})
    )
  )`;

  return and(
    ne(pages.visibility, "unlisted"),
    or(eq(pages.authorId, user.id), eq(pages.visibility, "public"), restrictedGrant),
  ) as SQL;
}
