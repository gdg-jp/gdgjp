import type { BearerIdentity } from "@gdgjp/gdg-lib";

export type ConnpassIdentity = Omit<BearerIdentity, "client"> & { mayWrite: boolean };

export function withWriteAuthority(
  identity: BearerIdentity,
  trustedClientIds: readonly string[] = [],
): ConnpassIdentity {
  const { client, ...rest } = identity;
  const mayWrite = client !== null && (client.firstParty || trustedClientIds.includes(client.id));
  return { ...rest, mayWrite };
}

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

export type AllowedLumaCalendar = {
  calendarApiId: string;
  chapterId: string | null;
  enabled: boolean;
};

export async function getAllowedLumaCalendar(
  db: D1Database,
  calendarApiId: string,
): Promise<AllowedLumaCalendar | null> {
  const row = await db
    .prepare(
      `SELECT calendar_api_id AS calendarApiId, chapter_id AS chapterId, enabled
       FROM luma_calendars WHERE calendar_api_id = ? LIMIT 1`,
    )
    .bind(calendarApiId)
    .first<{ calendarApiId: string; chapterId: string | null; enabled: number }>();
  if (!row) return null;
  return { calendarApiId: row.calendarApiId, chapterId: row.chapterId, enabled: row.enabled === 1 };
}

export function canReadGroup(identity: ConnpassIdentity, group: AllowedGroup): boolean {
  if (!group.enabled) return false;
  if (identity.user.isAdmin) return true;
  if (!group.chapterId) return identity.user.isAdmin;
  return identity.chapters.some((c) => String(c.chapterId) === String(group.chapterId));
}

export function canWriteGroup(
  identity: ConnpassIdentity,
  group: Pick<AllowedGroup, "chapterId" | "enabled">,
): boolean {
  if (!identity.mayWrite || !group.enabled) return false;
  if (identity.user.isAdmin) return true;
  if (!group.chapterId) return false;
  return identity.chapters.some(
    (c) => String(c.chapterId) === String(group.chapterId) && c.role === "organizer",
  );
}

export async function canWriteAnyGroup(
  db: D1Database,
  identity: ConnpassIdentity,
): Promise<boolean> {
  if (!identity.mayWrite) return false;
  if (identity.user.isAdmin) return true;
  const chapterIds = identity.chapters
    .filter((c) => c.role === "organizer")
    .map((c) => String(c.chapterId));
  if (chapterIds.length === 0) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM groups
       WHERE enabled = 1 AND chapter_id IN (${chapterIds.map(() => "?").join(", ")}) LIMIT 1`,
    )
    .bind(...chapterIds)
    .first<{ ok: number }>();
  return row != null;
}

export function requireAdmin(identity: ConnpassIdentity): boolean {
  return identity.mayWrite && identity.user.isAdmin;
}
