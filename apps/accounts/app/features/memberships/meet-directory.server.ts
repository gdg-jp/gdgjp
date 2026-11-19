import type {
  ChapterRole,
  ListChapterMembersInput,
  MeetDirectoryMember,
  MeetRpcResult,
} from "@gdgjp/gdg-lib";

/** 1 回の RPC 呼び出しで指定できるチャプター ID の上限。 */
export const MAX_MEET_DIRECTORY_CHAPTER_IDS = 50;

const DEFAULT_ROLES: readonly ChapterRole[] = ["organizer", "member"];
const VALID_ROLES = new Set<string>(DEFAULT_ROLES);

type MeetDirectoryMemberRow = {
  user_id: string;
  name: string;
  email: string;
  chapter_id: number;
  chapter_slug: string;
  chapter_name: string;
  role: ChapterRole;
};

function isChapterRole(value: unknown): value is ChapterRole {
  return typeof value === "string" && VALID_ROLES.has(value);
}

/**
 * `meet.gdgs.jp` 向け service-binding RPC の本体。
 * 呼び出し主体のアクティブ所属を DB で直接検証したうえで、指定チャプターの
 * `status = 'active'` なメンバーのみを返す。例外は投げず常に値で返す。
 */
export async function listMeetChapterMembers(
  db: D1Database,
  input: ListChapterMembersInput,
): Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>> {
  try {
    const userId = input?.actor?.user?.id;
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return { ok: false, code: "forbidden" };
    }

    // 引数 actor.chapters の自己申告は信頼せず、accounts D1 上の active 所属を直接検証する。
    const activeMembership = await db
      .prepare("SELECT 1 FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1")
      .bind(userId)
      .first();
    if (!activeMembership) {
      return { ok: false, code: "forbidden" };
    }

    if (!Array.isArray(input.chapterIds)) {
      return { ok: false, code: "invalid_chapter_ids" };
    }
    for (const id of input.chapterIds) {
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
        return { ok: false, code: "invalid_chapter_ids" };
      }
    }
    const uniqueChapterIds = [...new Set(input.chapterIds)];
    if (uniqueChapterIds.length > MAX_MEET_DIRECTORY_CHAPTER_IDS) {
      return { ok: false, code: "too_many_chapters" };
    }

    let uniqueRoles: ChapterRole[];
    if (input.roles === undefined) {
      uniqueRoles = [...DEFAULT_ROLES];
    } else {
      if (!Array.isArray(input.roles) || input.roles.length === 0) {
        return { ok: false, code: "invalid_roles" };
      }
      if (!input.roles.every(isChapterRole)) {
        return { ok: false, code: "invalid_roles" };
      }
      uniqueRoles = [...new Set(input.roles)];
    }

    if (uniqueChapterIds.length === 0) {
      return { ok: true, members: [] };
    }

    const chapterPlaceholders = uniqueChapterIds.map(() => "?").join(", ");
    const rolePlaceholders = uniqueRoles.map(() => "?").join(", ");

    const { results } = await db
      .prepare(
        `SELECT
           u.id AS user_id,
           u.name AS name,
           u.email AS email,
           c.id AS chapter_id,
           c.slug AS chapter_slug,
           c.name AS chapter_name,
           m.role AS role
         FROM memberships m
         JOIN "user" u ON u.id = m.user_id
         JOIN chapters c ON c.id = m.chapter_id
         WHERE m.status = 'active'
           AND m.chapter_id IN (${chapterPlaceholders})
           AND m.role IN (${rolePlaceholders})
         ORDER BY
           c.id ASC,
           CASE m.role WHEN 'organizer' THEN 0 ELSE 1 END,
           u.name ASC`,
      )
      .bind(...uniqueChapterIds, ...uniqueRoles)
      .all<MeetDirectoryMemberRow>();

    const members: MeetDirectoryMember[] = results.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      chapterId: row.chapter_id,
      chapterSlug: row.chapter_slug,
      chapterName: row.chapter_name,
      role: row.role,
    }));

    return { ok: true, members };
  } catch {
    return { ok: false, code: "internal_error" };
  }
}
