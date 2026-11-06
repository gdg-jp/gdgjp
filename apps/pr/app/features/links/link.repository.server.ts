import type { CampaignLink } from "./link";

type Row = {
  id: number;
  campaign_id: number;
  schedule_item_id: number | null;
  tinyurl_link_id: string;
  short_url: string;
  slug: string;
  destination_url: string;
  channel: string | null;
  og_image_url: string | null;
  health_failures: number;
  health_checked_at: number | null;
  health_alerted_at: number | null;
};

const toLink = (r: Row): CampaignLink => ({
  id: r.id,
  campaignId: r.campaign_id,
  scheduleItemId: r.schedule_item_id,
  tinyurlLinkId: r.tinyurl_link_id,
  shortUrl: r.short_url,
  slug: r.slug,
  destinationUrl: r.destination_url,
  channel: r.channel,
  ogImageUrl: r.og_image_url,
  healthFailures: r.health_failures,
  healthCheckedAt: r.health_checked_at,
  healthAlertedAt: r.health_alerted_at,
});

export async function linkForItem(db: D1Database, itemId: number): Promise<CampaignLink | null> {
  const row = await db
    .prepare("SELECT * FROM campaign_links WHERE schedule_item_id = ?")
    .bind(itemId)
    .first<Row>();
  return row ? toLink(row) : null;
}

export async function listLinks(db: D1Database, campaignId: number): Promise<CampaignLink[]> {
  const { results } = await db
    .prepare("SELECT * FROM campaign_links WHERE campaign_id = ? ORDER BY id DESC")
    .bind(campaignId)
    .all<Row>();
  return results.map(toLink);
}

/** Links of active campaigns, the oldest-checked first (the hourly health check). */
export async function linksToCheck(db: D1Database, limit = 50): Promise<CampaignLink[]> {
  const { results } = await db
    .prepare(
      `SELECT l.* FROM campaign_links l JOIN campaigns c ON c.id = l.campaign_id
       WHERE c.status = 'active' ORDER BY COALESCE(l.health_checked_at, 0) LIMIT ?`,
    )
    .bind(limit)
    .all<Row>();
  return results.map(toLink);
}

export async function insertLink(
  db: D1Database,
  link: Omit<CampaignLink, "id" | "healthFailures" | "healthCheckedAt" | "healthAlertedAt">,
) {
  await db
    .prepare(
      `INSERT INTO campaign_links (campaign_id, schedule_item_id, tinyurl_link_id, short_url, slug, destination_url, channel, og_image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (schedule_item_id) DO NOTHING`,
    )
    .bind(
      link.campaignId,
      link.scheduleItemId,
      link.tinyurlLinkId,
      link.shortUrl,
      link.slug,
      link.destinationUrl,
      link.channel,
      link.ogImageUrl,
    )
    .run();
}

export async function recordHealth(
  db: D1Database,
  id: number,
  alive: boolean,
  alerted: boolean,
): Promise<void> {
  await db
    .prepare(
      `UPDATE campaign_links SET
         health_failures = CASE WHEN ? THEN 0 ELSE health_failures + 1 END,
         health_checked_at = unixepoch(),
         health_alerted_at = CASE WHEN ? THEN NULL WHEN ? THEN unixepoch() ELSE health_alerted_at END
       WHERE id = ?`,
    )
    .bind(alive ? 1 : 0, alive ? 1 : 0, alerted ? 1 : 0, id)
    .run();
}

export async function campaignChannelId(
  db: D1Database,
  campaignId: number,
  channel: string | null,
): Promise<number | null> {
  if (!channel) return null;
  const row = await db
    .prepare(
      "SELECT tinyurl_channel_id FROM campaign_channels WHERE campaign_id = ? AND channel = ?",
    )
    .bind(campaignId, channel)
    .first<{ tinyurl_channel_id: number }>();
  return row?.tinyurl_channel_id ?? null;
}

export async function saveCampaignChannel(
  db: D1Database,
  campaignId: number,
  channel: string,
  tinyurlChannelId: number,
) {
  await db
    .prepare(
      `INSERT INTO campaign_channels (campaign_id, channel, tinyurl_channel_id) VALUES (?, ?, ?)
       ON CONFLICT (campaign_id, channel) DO UPDATE SET tinyurl_channel_id = excluded.tinyurl_channel_id`,
    )
    .bind(campaignId, channel, tinyurlChannelId)
    .run();
}

export async function listCampaignChannels(db: D1Database, campaignId: number) {
  const { results } = await db
    .prepare(
      "SELECT channel, tinyurl_channel_id FROM campaign_channels WHERE campaign_id = ? ORDER BY channel",
    )
    .bind(campaignId)
    .all<{ channel: string; tinyurl_channel_id: number }>();
  return results.map((r) => ({ channel: r.channel, tinyurlChannelId: r.tinyurl_channel_id }));
}
