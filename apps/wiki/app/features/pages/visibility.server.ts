import { type SQL, and, eq, ne, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "~/db/schema";
import { pages } from "~/db/schema";
import { type ChapterMembership, getEffectivePagePermissions } from "./access.server";

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

export function canUserSeePage(user: UserLike | null, page: PageLike): boolean {
  if (user?.isAdmin || (user && user.id === page.authorId)) return true;
  return page.visibility === "public" || page.visibility === "unlisted";
}

export async function canUserSeePageAsync(
  db: DrizzleD1Database<typeof schema>,
  user: UserLike | null,
  page: PageLike & { id: string },
  chapters: readonly (string | number | ChapterMembership)[] = [],
): Promise<boolean> {
  if (canUserSeePage(user, page)) return true;
  const permissions = await getEffectivePagePermissions(db, page, user, chapters);
  return permissions.canView;
}

export function buildVisibilityFilter(
  user: UserLike | null,
  chapters: readonly (string | number | ChapterMembership)[] = [],
): SQL {
  if (!user) return eq(pages.visibility, "public");
  if (user.isAdmin) return ne(pages.visibility, "unlisted");

  const normalizedEmail = user.email?.trim().toLowerCase() ?? "";
  const chapterKeys = chapters.map((chapter) =>
    String(typeof chapter === "object" ? chapter.chapterId : chapter),
  );
  const hasOrganizerRole = chapters.some(
    (chapter) => typeof chapter === "object" && chapter.role === "organizer",
  );
  const hasMemberRole = chapters.some(
    (chapter) =>
      typeof chapter === "object" && (chapter.role === "organizer" || chapter.role === "member"),
  );
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
  const roleGeneralGrant =
    hasOrganizerRole && hasMemberRole
      ? or(eq(pages.visibility, "organizer"), eq(pages.visibility, "member"))
      : hasOrganizerRole
        ? eq(pages.visibility, "organizer")
        : hasMemberRole
          ? eq(pages.visibility, "member")
          : sql`0`;

  return and(
    ne(pages.visibility, "unlisted"),
    or(
      eq(pages.authorId, user.id),
      eq(pages.visibility, "public"),
      restrictedGrant,
      roleGeneralGrant,
    ),
  ) as SQL;
}
