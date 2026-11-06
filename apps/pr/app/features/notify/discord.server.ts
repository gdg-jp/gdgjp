import { discordBody } from "./discord";

export type SendResult = { ok: true } | { ok: false; status: number; error: string };

/** POST one message. A 429 waits once (at most 5 s) and retries; the URL is never logged. */
export async function sendDiscord(
  webhookUrl: string,
  content: string,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  const send = () =>
    fetcher(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(discordBody(content)),
    });
  try {
    let response = await send();
    if (response.status === 429) {
      const retry = Number(
        ((await response.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 1,
      );
      await new Promise((r) => setTimeout(r, Math.min(5, Math.max(0, retry)) * 1000));
      response = await send();
    }
    return response.ok
      ? { ok: true }
      : { ok: false, status: response.status, error: `discord answered ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "network error",
    };
  }
}

/** Claim a notification key once; false means it was already sent (or is being sent). */
export async function claimNotification(db: D1Database, key: string): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO notifications_sent (key) VALUES (?)")
    .bind(key)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
