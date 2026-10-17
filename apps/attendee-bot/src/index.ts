export interface Env {
  /** "true" | "false". Notifications are skipped unless "true". */
  ENABLE_NOTIFICATION: string;
  CONNPASS_API_BASE_URL: string;
  CONNPASS_GROUP_ID: string;
  CONNPASS_EVENT_ID: string;
  /** Secret: Discord webhook URL. */
  DISCORD_WEBHOOK_URL: string;
  /** Secret: Bearer token for the connpass API (optional if the endpoint is open). */
  CONNPASS_API_TOKEN?: string;
}

export interface EventStatistics {
  registeredCount: number;
  waitlistedCount: number;
  canceledCount: number;
  checkedInCount: number;
}

export function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export async function fetchStatistics(env: Env): Promise<EventStatistics> {
  const base = env.CONNPASS_API_BASE_URL.replace(/\/+$/, "");
  const url = `${base}/api/groups/${encodeURIComponent(env.CONNPASS_GROUP_ID)}/events/${encodeURIComponent(env.CONNPASS_EVENT_ID)}/stats`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.CONNPASS_API_TOKEN) headers.Authorization = `Bearer ${env.CONNPASS_API_TOKEN}`;
  const res = await fetch(url, { headers });
  console.log(url);
  if (!res.ok) throw new Error(`stats request failed: ${res.status}`);
  const body = (await res.json()) as { statistics?: EventStatistics };
  if (!body.statistics) throw new Error("stats response missing statistics");
  return body.statistics;
}

export function buildPayload(stats: EventStatistics, now = new Date()) {
  return {
    embeds: [
      {
        title: "📊 イベント出席状況",
        color: 0x4285f4,
        fields: [
          { name: "参加者数", value: String(stats.registeredCount), inline: true },
          { name: "チェックイン数", value: String(stats.checkedInCount), inline: true },
          { name: "補欠数", value: String(stats.waitlistedCount), inline: true },
          { name: "キャンセル数", value: String(stats.canceledCount), inline: true },
        ],
        timestamp: now.toISOString(),
      },
    ],
  };
}

export async function notify(env: Env): Promise<void> {
  if (!isEnabled(env.ENABLE_NOTIFICATION)) return;
  const stats = await fetchStatistics(env);
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(stats)),
  });
  if (!res.ok) throw new Error(`discord webhook failed: ${res.status}`);
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(notify(env));
  },
} satisfies ExportedHandler<Env>;
