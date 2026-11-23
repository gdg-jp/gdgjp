import { discordBody } from "./discord";

export type SendResult = { ok: true } | { ok: false; status: number; error: string };

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

export async function claimNotification(db: D1Database, key: string): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO notifications_sent (key) VALUES (?)")
    .bind(key)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
