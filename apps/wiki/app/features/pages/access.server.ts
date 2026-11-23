import { and, eq, inArray, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import type {
  ChapterMembership,
  EffectivePagePermissions,
  EffectivePageRole,
  PageAccessEntry,
  PagePermissionSubject,
  PageRole,
  PermissionSource,
  ShareSubjectType,
  UserLike,
} from "./access-types";
import { ROLE_RANK, isPageRole, maxRole, normalizeEmail } from "./access-types";

export type {
  ChapterMembership,
  EffectivePagePermissions,
  EffectivePageRole,
  GeneralAccess,
  PageAccessEntry,
  PagePermissionSubject,
  PageRole,
  PermissionSource,
  ShareSubject,
  ShareSubjectType,
} from "./access-types";
export { isGeneralAccess, isPageRole, normalizeEmail } from "./access-types";
export {
  insertPageOwner,
  removePageAccess,
  updatePageAccessRole,
  upsertPageAccess,
} from "./access-mutations.server";

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

export async function getEffectivePagePermissions(
  db: DrizzleD1Database<typeof schema>,
  page: PagePermissionSubject,
  user: UserLike | null,
  chapters: readonly (string | number | ChapterMembership)[] = [],
): Promise<EffectivePagePermissions> {
  if (!user || user.isAdmin || user.id === page.authorId) {
    return evaluatePagePermissions(page, user);
  }
  const chapterIds = chapters.map((chapter) =>
    typeof chapter === "object" ? chapter.chapterId : chapter,
  );
  const explicit = await getExplicitPageRoles(db, page.id, user, chapterIds);
  return evaluatePagePermissions(page, user, explicit, chapters);
}

export function evaluatePagePermissions(
  page: PagePermissionSubject,
  user: UserLike | null,
  explicit: Array<{
    role: PageRole;
    source: Exclude<PermissionSource, "owner" | "admin" | "general" | null>;
  }> = [],
  chapters: readonly (string | number | ChapterMembership)[] = [],
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

  const hasOrganizerRole = chapters.some(
    (chapter) => typeof chapter === "object" && chapter.role === "organizer",
  );
  const hasMemberRole = chapters.some(
    (chapter) =>
      typeof chapter === "object" && (chapter.role === "organizer" || chapter.role === "member"),
  );
  const generalCandidate =
    hasGeneralAccess ||
    (page.visibility === "organizer" && hasOrganizerRole) ||
    (page.visibility === "member" && hasMemberRole)
      ? generalRole
      : null;
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
    canManageSharing: explicit.some((entry) => entry.role === "editor"),
    source,
  };
}

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
