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
