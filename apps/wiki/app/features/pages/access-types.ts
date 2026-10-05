/**
 * Shared vocabulary for page access: role/visibility types, guards, and the
 * pure role-ranking helpers. Query-time resolution lives in `access.server.ts`;
 * ACL mutations live in `access-mutations.server.ts`.
 */

export type GeneralAccess = "restricted" | "unlisted" | "public" | "organizer" | "member";
export type PageRole = "viewer" | "commenter" | "editor";
export type EffectivePageRole = "owner" | PageRole | null;
export type ShareSubjectType = "email" | "chapter";
export type PermissionSource = "owner" | "admin" | "email" | "chapter" | "general" | null;
export type ChapterMembership = { chapterId: string | number; role: string };

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

export type UserLike = {
  id: string;
  isAdmin: boolean | null | undefined;
  email?: string | null;
};

export const ROLE_RANK: Record<Exclude<EffectivePageRole, null>, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

export function isPageRole(value: unknown): value is PageRole {
  return value === "viewer" || value === "commenter" || value === "editor";
}

export function isGeneralAccess(value: unknown): value is GeneralAccess {
  return (
    value === "restricted" ||
    value === "unlisted" ||
    value === "public" ||
    value === "organizer" ||
    value === "member"
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

export function maxRole(roles: PageRole[]): PageRole | null {
  return roles.reduce<PageRole | null>((current, role) => {
    if (!current || ROLE_RANK[role] > ROLE_RANK[current]) return role;
    return current;
  }, null);
}
