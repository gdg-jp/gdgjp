import { getCampaignById } from "~/features/campaigns/campaign.repository.server";
import { notifyChapter, template } from "~/features/notify/send.server";
import { HEALTH_FAILURE_THRESHOLD, isAlive } from "./link";
import { linksToCheck, recordHealth } from "./link.repository.server";

/** HEAD, then GET when HEAD is refused; redirects are followed. 0 = no answer. */
export async function probe(url: string, fetcher: typeof fetch = fetch): Promise<number> {
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await fetcher(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      if (method === "HEAD" && (response.status === 405 || response.status === 501)) continue;
      return response.status;
    } catch {
      if (method === "GET") return 0;
    }
  }
  return 0;
}

/**
 * Hourly: check every short link's destination of active campaigns. Two failures in a row
 * send one Discord alert (and the settings page shows the link red) until it answers again.
 */
export async function checkLinkHealth(env: Env, fetcher: typeof fetch = fetch) {
  const links = await linksToCheck(env.DB);
  let broken = 0;
  for (const link of links) {
    const status = await probe(link.destinationUrl, fetcher);
    const alive = isAlive(status);
    const reachesThreshold = !alive && link.healthFailures + 1 >= HEALTH_FAILURE_THRESHOLD;
    const alert = reachesThreshold && link.healthAlertedAt === null;
    if (!alive && reachesThreshold) broken++;
    if (alert) {
      const campaign = await getCampaignById(env.DB, link.campaignId);
      if (campaign)
        await notifyChapter(env, {
          chapterId: campaign.chapterId,
          campaignId: campaign.id,
          itemId: link.scheduleItemId,
          key: `link:${link.id}:${link.healthCheckedAt ?? 0}`,
          content: template("linkBroken", {
            target: `${link.shortUrl} → ${link.destinationUrl}`,
            status: status ? String(status) : "応答なし",
            campaign: campaign.name,
            url: `${env.APP_URL}/c/${campaign.slug}/settings`,
          }),
          action: "discord_link_broken",
        });
    }
    await recordHealth(env.DB, link.id, alive, alert);
  }
  return { checked: links.length, broken };
}
