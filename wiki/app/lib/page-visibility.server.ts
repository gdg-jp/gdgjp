import { type SQL, and, eq, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "~/db/schema";
import { pages } from "~/db/schema";
import { hasRole } from "./auth-utils.server";
import { getUserPageRole } from "./page-access.server";

type UserLike = {
  id: string;
  role: string;
  chapterId?: string | null;
  email?: string | null;
};

type PageLike = {
  id?: string;
  visibility: string;
  chapterId?: string | null;
  authorId: string;
};

export function canUserSeePage(user: UserLike, page: PageLike): boolean {
  if (hasRole(user.role, "admin")) return true;
  if (page.visibility === "public" && hasRole(user.role, "member")) return true;
  if (user.id === page.authorId) return true;

  if (page.visibility === "private_to_chapter") {
    return !!user.chapterId && user.chapterId === page.chapterId;
  }

  if (page.visibility === "private_to_lead") {
    return hasRole(user.role, "lead") && !!user.chapterId && user.chapterId === page.chapterId;
  }

  // "restricted" — conservative; callers needing restricted access use canUserSeePageAsync
  if (page.visibility === "restricted") return false;

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
  if (hasRole(user.role, "admin")) return true;
  if (user.id === page.authorId) return true;
  const role = await getUserPageRole(db, page.id, user.id, user.email);
  return role !== null;
}

export function canUserChangeVisibility(user: UserLike, page: PageLike): boolean {
  if (hasRole(user.role, "admin")) return true;
  if (hasRole(user.role, "lead") && !!user.chapterId && user.chapterId === page.chapterId) {
    return true;
  }
  if (user.id === page.authorId) return true;
  return false;
}

export function buildVisibilityFilter(user: UserLike): SQL | undefined {
  if (hasRole(user.role, "admin")) return undefined;

  const conditions: SQL[] = [eq(pages.authorId, user.id)];

  if (hasRole(user.role, "member")) {
    conditions.push(eq(pages.visibility, "public"));
  }

  if (user.chapterId) {
    const chapterMatch = and(
      eq(pages.visibility, "private_to_chapter"),
      eq(pages.chapterId, user.chapterId),
    );
    if (chapterMatch) conditions.push(chapterMatch);

    if (hasRole(user.role, "lead")) {
      const leadMatch = and(
        eq(pages.visibility, "private_to_lead"),
        eq(pages.chapterId, user.chapterId),
      );
      if (leadMatch) conditions.push(leadMatch);
    }
  }

  // Restricted pages: visible if user has a page_access record
  const restrictedMatch = and(
    eq(pages.visibility, "restricted"),
    sql`EXISTS (SELECT 1 FROM page_access WHERE page_id = ${pages.id}
      AND (user_id = ${user.id} OR email = ${user.email ?? ""}))`,
  );
  if (restrictedMatch) conditions.push(restrictedMatch);

  return or(...conditions);
}
