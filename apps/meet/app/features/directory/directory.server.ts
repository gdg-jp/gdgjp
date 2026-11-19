import type {
  AuthUser,
  ListChapterMembersInput,
  ListUserAvatarsByEmailsInput,
  MeetDirectoryMember,
  MeetDirectoryService,
  MeetRpcResult,
  MeetUserAvatar,
} from "@gdgjp/gdg-lib";
import { normalizeEmail } from "~/features/google/email";
import { type ChapterSummary, sanitizeAvatarUrl } from "./directory";

const SQL_EMAIL_CHUNK_SIZE = 50;
const RPC_EMAIL_CHUNK_SIZE = 200;

/** チャプター一覧または RPC メンバー取得の失敗を表すサーバー内部専用エラー。 */
export class DirectoryError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DirectoryError";
  }
}

function meetDirectoryService(env: Env): MeetDirectoryService {
  return env.ACCOUNTS_DIRECTORY as unknown as MeetDirectoryService;
}

/**
 * RP ローカルの `user.id` を GDG Accounts のユーザー ID（OIDC `sub`）へ変換する。
 * gdg-lib は RP ごとに独自の UUID を `user.id` に発行するため、accounts 側の
 * `memberships` 照合にはサインイン時に保存した `oidc_subject` を渡す必要がある。
 */
async function resolveAccountsUserId(env: Env, localUserId: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT oidc_subject FROM "user" WHERE id = ? LIMIT 1`)
    .bind(localUserId)
    .first<{ oidc_subject: string | null }>();
  if (!row?.oidc_subject) {
    throw new DirectoryError("forbidden", "GDG Accounts のユーザー ID を特定できません");
  }
  return row.oidc_subject;
}

/**
 * `ACCOUNTS` service binding 経由で公開チャプター一覧を取得し、`ChapterSummary` へ正規化する。
 * レスポンスに含まれる余分なプロパティは取り除き、ブラウザ共有可能な最小フィールドのみ返す。
 */
export async function fetchChaptersDirectory(env: Env): Promise<ChapterSummary[]> {
  const url = new URL("/api/chapters/directory", env.ACCOUNTS_URL).toString();
  const response = await env.ACCOUNTS.fetch(url);
  if (!response.ok) {
    throw new DirectoryError(
      "chapters_fetch_failed",
      `チャプター一覧の取得に失敗しました (HTTP ${response.status})`,
    );
  }

  let data: { chapters?: unknown };
  try {
    data = (await response.json()) as { chapters?: unknown };
  } catch {
    throw new DirectoryError(
      "invalid_chapters_response",
      "チャプター一覧の JSON 解析に失敗しました",
    );
  }

  if (!data || !Array.isArray(data.chapters)) {
    throw new DirectoryError(
      "invalid_chapters_response",
      "チャプター一覧のレスポンス形式が不正です",
    );
  }

  return data.chapters.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new DirectoryError("invalid_chapters_response", "チャプター要素の形式が不正です");
    }
    const item = raw as Record<string, unknown>;
    const id = Number(item.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new DirectoryError("invalid_chapters_response", "チャプター ID の形式が不正です");
    }
    return {
      id,
      slug: String(item.slug ?? ""),
      name: String(item.name ?? ""),
      kind: String(item.kind ?? ""),
      region: String(item.region ?? ""),
    };
  });
}

/**
 * `ACCOUNTS_DIRECTORY` service binding（`MeetDirectoryService`）経由で
 * 指定チャプターのアクティブメンバーを取得する（サーバー内部専用）。
 * 返却される `email` はブラウザ向け loader 応答へ決して渡さないこと。
 */
export async function fetchChapterMembers(
  env: Env,
  input: ListChapterMembersInput,
): Promise<MeetDirectoryMember[]> {
  const service = meetDirectoryService(env);
  const accountsUserId = await resolveAccountsUserId(env, input.actor.user.id);
  const rpcInput: ListChapterMembersInput = {
    ...input,
    actor: { ...input.actor, user: { ...input.actor.user, id: accountsUserId } },
  };
  let result: MeetRpcResult<{ members: MeetDirectoryMember[] }>;
  try {
    result = await service.listChapterMembers(rpcInput);
  } catch (error) {
    throw new DirectoryError(
      "binding_error",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!result.ok) {
    throw new DirectoryError(result.code, result.message);
  }
  return result.members;
}

type LocalUserAvatarRow = {
  email: string;
  image: string | null;
};

function deduplicateNormalizedEmails(emails: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of emails) {
    const normalized = normalizeEmail(raw);
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

/**
 * `ACCOUNTS_DIRECTORY` RPC 経由で招待者の最新プロフィール画像 URL を取得する。
 * `oidc_subject` 不在や RPC 障害時は例外を投げず空（または取得済み分）の Map を返し、
 * 画面表示はフォールバックアイコンへ倒す。
 */
export async function fetchUserAvatarsByEmails(
  env: Env,
  localUserId: string,
  emails: readonly string[],
): Promise<Map<string, string>> {
  const uniqueEmails = deduplicateNormalizedEmails(emails);
  if (uniqueEmails.length === 0) return new Map();

  let actorUserId: string;
  try {
    actorUserId = await resolveAccountsUserId(env, localUserId);
  } catch {
    return new Map();
  }

  const service = meetDirectoryService(env);
  if (typeof service?.listUserAvatarsByEmails !== "function") {
    return new Map();
  }

  const avatars = new Map<string, string>();
  for (let offset = 0; offset < uniqueEmails.length; offset += RPC_EMAIL_CHUNK_SIZE) {
    const chunk = uniqueEmails.slice(offset, offset + RPC_EMAIL_CHUNK_SIZE);
    const rpcInput: ListUserAvatarsByEmailsInput = { actorUserId, emails: chunk };
    let result: MeetRpcResult<{ avatars: MeetUserAvatar[] }>;
    try {
      result = await service.listUserAvatarsByEmails(rpcInput);
    } catch {
      continue;
    }
    if (!result.ok || !Array.isArray(result.avatars)) continue;
    for (const entry of result.avatars) {
      const normalized = normalizeEmail(entry.emailNormalized);
      const safeUrl = sanitizeAvatarUrl(entry.image);
      if (normalized && safeUrl && !avatars.has(normalized)) {
        avatars.set(normalized, safeUrl);
      }
    }
  }

  return avatars;
}

/**
 * `apps/meet` ローカル D1 の `"user"` テーブルからプロフィール画像 URL を取得する（フォールバック用）。
 * SQLite / D1 のバインド変数上限（100）を避けるため 50 件ずつ分割して照会する。
 */
export async function listLocalUserAvatarsByEmails(
  db: D1Database,
  emails: readonly string[],
): Promise<Map<string, string>> {
  const uniqueEmails = deduplicateNormalizedEmails(emails);
  if (uniqueEmails.length === 0) return new Map();

  const uniqueSet = new Set(uniqueEmails);
  const avatars = new Map<string, string>();

  try {
    for (let offset = 0; offset < uniqueEmails.length; offset += SQL_EMAIL_CHUNK_SIZE) {
      const chunk = uniqueEmails.slice(offset, offset + SQL_EMAIL_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await db
        .prepare(
          `SELECT email, image
           FROM "user"
           WHERE image IS NOT NULL
             AND TRIM(image) != ''
             AND (
               CASE
                 WHEN instr(TRIM(email), '@') > 1
                   AND LOWER(substr(TRIM(email), instr(TRIM(email), '@') + 1)) IN ('gmail.com', 'googlemail.com')
                 THEN LOWER(replace(substr(TRIM(email), 1, instr(TRIM(email), '@') - 1), '.', '') || substr(TRIM(email), instr(TRIM(email), '@')))
                 ELSE LOWER(TRIM(email))
               END
             ) IN (${placeholders})
           ORDER BY updated_at DESC, id ASC`,
        )
        .bind(...chunk)
        .all<LocalUserAvatarRow>();

      for (const row of result.results ?? []) {
        const normalized = normalizeEmail(row.email);
        if (!uniqueSet.has(normalized) || avatars.has(normalized)) continue;
        const safeUrl = sanitizeAvatarUrl(row.image);
        if (safeUrl) {
          avatars.set(normalized, safeUrl);
        }
      }
    }
  } catch {
    return new Map();
  }

  return avatars;
}

/**
 * 招待者ごとの Google アカウント画像 URL を解決する。
 * 優先順位: `accounts` RPC ＞ 閲覧者自身のセッション画像 ＞ ローカル D1 `"user"`。
 */
export async function resolveInviteeAvatars(
  env: Env,
  user: Pick<AuthUser, "id" | "email" | "image">,
  invitees: readonly { emailNormalized: string }[],
): Promise<Map<string, string>> {
  const uniqueEmails = deduplicateNormalizedEmails(invitees.map((inv) => inv.emailNormalized));
  if (uniqueEmails.length === 0) return new Map();

  const uniqueSet = new Set(uniqueEmails);
  const [accountsAvatars, localAvatars] = await Promise.all([
    fetchUserAvatarsByEmails(env, user.id, uniqueEmails),
    listLocalUserAvatarsByEmails(env.DB, uniqueEmails),
  ]);

  const resolved = new Map<string, string>(localAvatars);

  const viewerEmailNormalized = normalizeEmail(user.email);
  const viewerAvatar = sanitizeAvatarUrl(user.image);
  if (viewerAvatar && uniqueSet.has(viewerEmailNormalized)) {
    resolved.set(viewerEmailNormalized, viewerAvatar);
  }

  for (const [emailNormalized, image] of accountsAvatars) {
    resolved.set(emailNormalized, image);
  }

  return resolved;
}
