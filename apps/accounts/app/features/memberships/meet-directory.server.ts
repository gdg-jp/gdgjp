import type {
  ChapterRole,
  ListChapterMembersInput,
  ListRegisteredEmailsInput,
  ListUserAvatarsByEmailsInput,
  MeetDirectoryMember,
  MeetRpcFailure,
  MeetRpcResult,
  MeetUserAvatar,
} from "@gdgjp/gdg-lib";

export const MAX_MEET_DIRECTORY_CHAPTER_IDS = 50;

export const MAX_MEET_AVATAR_EMAILS = 200;

const SQL_EMAIL_CHUNK_SIZE = 50;
const MAX_AVATAR_URL_LENGTH = 2048;

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

export async function listMeetChapterMembers(
  db: D1Database,
  input: ListChapterMembersInput,
): Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>> {
  try {
    const userId = input?.actor?.user?.id;
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return { ok: false, code: "forbidden" };
    }

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

type MeetAvatarRow = {
  email: string;
  image: string | null;
};

function normalizeMeetEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || trimmed.indexOf("@", atIndex + 1) !== -1) {
    return trimmed;
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replaceAll(".", "")}@${domain}`;
  }
  return `${local}@${domain}`;
}

function sanitizeAvatarUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_AVATAR_URL_LENGTH) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const SQL_NORMALIZED_USER_EMAIL = `
  CASE
    WHEN instr(TRIM(email), '@') > 1
      AND LOWER(substr(TRIM(email), instr(TRIM(email), '@') + 1)) IN ('gmail.com', 'googlemail.com')
    THEN LOWER(replace(substr(TRIM(email), 1, instr(TRIM(email), '@') - 1), '.', '') || substr(TRIM(email), instr(TRIM(email), '@')))
    ELSE LOWER(TRIM(email))
  END
`;

type PreparedEmailLookup =
  | { ok: true; uniqueEmails: string[]; uniqueEmailSet: Set<string> }
  | MeetRpcFailure;

async function prepareUserEmailLookup(
  db: D1Database,
  input: { actorUserId?: unknown; emails?: unknown } | null | undefined,
): Promise<PreparedEmailLookup> {
  const rawActorUserId = input?.actorUserId;
  if (typeof rawActorUserId !== "string" || rawActorUserId.trim().length === 0) {
    return { ok: false, code: "forbidden" };
  }
  const actorUserId = rawActorUserId.trim();

  const actorExists = await db
    .prepare('SELECT 1 FROM "user" WHERE id = ? LIMIT 1')
    .bind(actorUserId)
    .first();
  if (!actorExists) {
    return { ok: false, code: "forbidden" };
  }

  if (!Array.isArray(input?.emails)) {
    return { ok: false, code: "invalid_emails" };
  }

  const uniqueEmailSet = new Set<string>();
  for (const item of input.emails) {
    if (typeof item !== "string") {
      return { ok: false, code: "invalid_emails" };
    }
    const normalized = normalizeMeetEmail(item);
    if (normalized.length > 0) {
      uniqueEmailSet.add(normalized);
    }
  }

  const uniqueEmails = [...uniqueEmailSet];
  if (uniqueEmails.length > MAX_MEET_AVATAR_EMAILS) {
    return { ok: false, code: "too_many_emails" };
  }

  return { ok: true, uniqueEmails, uniqueEmailSet };
}

export async function listMeetUserAvatarsByEmails(
  db: D1Database,
  input: ListUserAvatarsByEmailsInput,
): Promise<MeetRpcResult<{ avatars: MeetUserAvatar[] }>> {
  try {
    const prepared = await prepareUserEmailLookup(db, input);
    if (!prepared.ok) {
      return prepared;
    }
    const { uniqueEmails, uniqueEmailSet } = prepared;
    if (uniqueEmails.length === 0) {
      return { ok: true, avatars: [] };
    }

    const avatarMap = new Map<string, string>();
    for (let offset = 0; offset < uniqueEmails.length; offset += SQL_EMAIL_CHUNK_SIZE) {
      const chunk = uniqueEmails.slice(offset, offset + SQL_EMAIL_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const { results } = await db
        .prepare(
          `SELECT email, image
           FROM "user"
           WHERE image IS NOT NULL
             AND TRIM(image) != ''
             AND (${SQL_NORMALIZED_USER_EMAIL}) IN (${placeholders})
           ORDER BY updated_at DESC, id ASC`,
        )
        .bind(...chunk)
        .all<MeetAvatarRow>();

      for (const row of results) {
        const normalized = normalizeMeetEmail(row.email);
        if (!uniqueEmailSet.has(normalized) || avatarMap.has(normalized)) continue;
        const safeUrl = sanitizeAvatarUrl(row.image);
        if (safeUrl) {
          avatarMap.set(normalized, safeUrl);
        }
      }
    }

    const avatars: MeetUserAvatar[] = [...avatarMap.entries()].map(([emailNormalized, image]) => ({
      emailNormalized,
      image,
    }));

    return { ok: true, avatars };
  } catch {
    return { ok: false, code: "internal_error" };
  }
}

export async function listMeetRegisteredEmails(
  db: D1Database,
  input: ListRegisteredEmailsInput,
): Promise<MeetRpcResult<{ emails: string[] }>> {
  try {
    const prepared = await prepareUserEmailLookup(db, input);
    if (!prepared.ok) {
      return prepared;
    }
    const { uniqueEmails, uniqueEmailSet } = prepared;
    if (uniqueEmails.length === 0) {
      return { ok: true, emails: [] };
    }

    const registeredSet = new Set<string>();
    for (let offset = 0; offset < uniqueEmails.length; offset += SQL_EMAIL_CHUNK_SIZE) {
      const chunk = uniqueEmails.slice(offset, offset + SQL_EMAIL_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const { results } = await db
        .prepare(
          `SELECT email
           FROM "user"
           WHERE (${SQL_NORMALIZED_USER_EMAIL}) IN (${placeholders})`,
        )
        .bind(...chunk)
        .all<{ email: string }>();

      for (const row of results) {
        const normalized = normalizeMeetEmail(row.email);
        if (uniqueEmailSet.has(normalized)) {
          registeredSet.add(normalized);
        }
      }
    }

    return { ok: true, emails: [...registeredSet] };
  } catch {
    return { ok: false, code: "internal_error" };
  }
}
