import type { BearerIdentity } from "@gdgjp/gdg-lib";

export type AllowedGroup = {
  groupSlug: string;
  groupId: number | null;
  chapterId: string | null;
  enabled: boolean;
};

export function resolveGroupSlug(groupIdParam: string): string {
  return groupIdParam.trim().toLowerCase();
}

export async function getAllowedGroup(
  db: D1Database,
  groupSlug: string,
): Promise<AllowedGroup | null> {
  const row = await db
    .prepare(
      `SELECT group_slug AS groupSlug, group_id AS groupId, chapter_id AS chapterId, enabled
       FROM groups WHERE group_slug = ? OR CAST(group_id AS TEXT) = ? LIMIT 1`,
    )
    .bind(groupSlug, groupSlug)
    .first<{
      groupSlug: string;
      groupId: number | null;
      chapterId: string | null;
      enabled: number;
    }>();
  if (!row) return null;
  return {
    groupSlug: row.groupSlug,
    groupId: row.groupId,
    chapterId: row.chapterId,
    enabled: row.enabled === 1,
  };
}

export async function getAllowedGroupByNumericId(
  db: D1Database,
  numericGroupId: number,
): Promise<AllowedGroup | null> {
  const row = await db
    .prepare(
      `SELECT group_slug AS groupSlug, group_id AS groupId, chapter_id AS chapterId, enabled
       FROM groups WHERE group_id = ? LIMIT 1`,
    )
    .bind(numericGroupId)
    .first<{
      groupSlug: string;
      groupId: number | null;
      chapterId: string | null;
      enabled: number;
    }>();
  if (!row) return null;
  return {
    groupSlug: row.groupSlug,
    groupId: row.groupId,
    chapterId: row.chapterId,
    enabled: row.enabled === 1,
  };
}

export function canReadGroup(identity: BearerIdentity, group: AllowedGroup): boolean {
  if (!group.enabled) return false;
  if (identity.user.isAdmin) return true;
  if (!group.chapterId) return identity.user.isAdmin;
  return identity.chapters.some((c) => String(c.chapterId) === String(group.chapterId));
}

export function canWriteGroup(identity: BearerIdentity, group: AllowedGroup): boolean {
  if (!group.enabled) return false;
  if (identity.user.isAdmin) return true;
  if (!group.chapterId) return false;
  return identity.chapters.some(
    (c) => String(c.chapterId) === String(group.chapterId) && c.role === "organizer",
  );
}

export function requireAdmin(identity: BearerIdentity): boolean {
  return identity.user.isAdmin;
}
