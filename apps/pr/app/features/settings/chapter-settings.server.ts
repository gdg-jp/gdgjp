import { isWebhookUrl, maskWebhook } from "~/features/notify/discord";
import { decryptSecret, encryptSecret } from "~/lib/crypto.server";

const development = (env: Env) => env.ENVIRONMENT !== "production";

export async function saveDiscordWebhook(
  env: Env,
  chapterId: number,
  url: string | null,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (url && !isWebhookUrl(url, development(env)))
    return { ok: false, error: "Discord の webhook URL ではありません" };
  const cipher = url ? await encryptSecret(env.SETTINGS_ENCRYPTION_KEY, url) : null;
  await env.DB.prepare(
    `INSERT INTO chapter_settings (chapter_id, discord_webhook_cipher, updated_by) VALUES (?, ?, ?)
     ON CONFLICT (chapter_id) DO UPDATE SET discord_webhook_cipher = excluded.discord_webhook_cipher,
       updated_by = excluded.updated_by, updated_at = unixepoch()`,
  )
    .bind(chapterId, cipher, userId)
    .run();
  return { ok: true };
}

/** The decrypted webhook, server-side only. */
export async function discordWebhookFor(env: Env, chapterId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT discord_webhook_cipher FROM chapter_settings WHERE chapter_id = ?",
  )
    .bind(chapterId)
    .first<{ discord_webhook_cipher: string | null }>();
  if (!row?.discord_webhook_cipher) return null;
  try {
    return await decryptSecret(env.SETTINGS_ENCRYPTION_KEY, row.discord_webhook_cipher);
  } catch {
    return null;
  }
}

export async function maskedDiscordWebhook(env: Env, chapterId: number): Promise<string | null> {
  const url = await discordWebhookFor(env, chapterId);
  return url ? maskWebhook(url) : null;
}

export type AssistantMode = "auto" | "suggest";
export type AssistantSettings = { mode: AssistantMode; morningDigest: boolean };

/** Defaults (no row yet): the assistant queues plans and drafts itself, and sends the digest. */
export async function assistantSettings(
  db: D1Database,
  chapterId: number,
): Promise<AssistantSettings> {
  const row = await db
    .prepare("SELECT assistant_mode, morning_digest FROM chapter_settings WHERE chapter_id = ?")
    .bind(chapterId)
    .first<{ assistant_mode: string; morning_digest: number }>();
  return {
    mode: row?.assistant_mode === "suggest" ? "suggest" : "auto",
    morningDigest: row ? row.morning_digest === 1 : true,
  };
}

export async function saveAssistantSettings(
  db: D1Database,
  chapterId: number,
  settings: AssistantSettings,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chapter_settings (chapter_id, assistant_mode, morning_digest, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (chapter_id) DO UPDATE SET assistant_mode = excluded.assistant_mode,
         morning_digest = excluded.morning_digest, updated_by = excluded.updated_by, updated_at = unixepoch()`,
    )
    .bind(chapterId, settings.mode, settings.morningDigest ? 1 : 0, userId)
    .run();
}

/** Chapters whose 09:00 digest is on (no row means on), among the given ones. */
export async function digestChapters(db: D1Database, chapterIds: number[]): Promise<number[]> {
  if (!chapterIds.length) return [];
  const { results } = await db
    .prepare(
      `SELECT chapter_id FROM chapter_settings WHERE morning_digest = 0 AND chapter_id IN (${chapterIds.map(() => "?").join(",")})`,
    )
    .bind(...chapterIds)
    .all<{ chapter_id: number }>();
  const off = new Set(results.map((r) => r.chapter_id));
  return chapterIds.filter((id) => !off.has(id));
}
