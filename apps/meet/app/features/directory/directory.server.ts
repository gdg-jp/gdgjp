import type {
  ListChapterMembersInput,
  MeetDirectoryMember,
  MeetDirectoryService,
  MeetRpcResult,
} from "@gdgjp/gdg-lib";
import type { ChapterSummary } from "./directory";

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
