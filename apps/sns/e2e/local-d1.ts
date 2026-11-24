import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wranglerPackagePath = require.resolve("wrangler/package.json");
const wranglerPackage = require(wranglerPackagePath) as { bin: string | { wrangler: string } };
const wranglerEntrypoint = resolve(
  dirname(wranglerPackagePath),
  typeof wranglerPackage.bin === "string" ? wranglerPackage.bin : wranglerPackage.bin.wrangler,
);

function execute(sql: string): string {
  return execFileSync(
    process.execPath,
    [wranglerEntrypoint, "d1", "execute", "gdgjp-sns-db", "--local", "--json", "--command", sql],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: "pipe" },
  );
}

export function queryLocalD1<T>(sql: string): T[] {
  const [result] = JSON.parse(execute(sql)) as { results: T[] }[];
  return result?.results ?? [];
}

export function seedXAccount(account: {
  id: string;
  chapterId: number;
  xUserId: string;
  username: string;
}): void {
  execute(
    `INSERT OR REPLACE INTO x_accounts (id, chapter_id, x_user_id, username, display_name,
       access_token_ciphertext, authorized_by_user_id, created_at, updated_at, revoked_at)
     VALUES ('${account.id}', ${account.chapterId}, '${account.xUserId}', '${account.username}',
       '${account.username}', 'fixture-not-encrypted', 'dev-user-e2e',
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`,
  );
}

export function organizerLogin(as: string, chapterId: number, returnTo: string): string {
  const query = new URLSearchParams({
    as,
    chapter: `${chapterId}:e2e-chapter-${chapterId}:organizer`,
    return_to: returnTo,
  });
  return `/dev/login?${query}`;
}
