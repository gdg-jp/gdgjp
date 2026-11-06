export type CampaignLink = {
  id: number;
  campaignId: number;
  scheduleItemId: number | null;
  tinyurlLinkId: string;
  shortUrl: string;
  slug: string;
  destinationUrl: string;
  channel: string | null;
  ogImageUrl: string | null;
  healthFailures: number;
  healthCheckedAt: number | null;
  healthAlertedAt: number | null;
};

/** Failures in a row before a link is reported broken. */
export const HEALTH_FAILURE_THRESHOLD = 2;

export type HealthState = "ok" | "unknown" | "warning" | "broken";

export function healthState(link: Pick<CampaignLink, "healthFailures" | "healthCheckedAt">) {
  if (link.healthCheckedAt === null) return "unknown" as const;
  if (link.healthFailures >= HEALTH_FAILURE_THRESHOLD) return "broken" as const;
  return link.healthFailures > 0 ? ("warning" as const) : ("ok" as const);
}

/** 2xx and 3xx are alive (redirects are followed, but a final 3xx still answers). */
export const isAlive = (status: number) => status >= 200 && status < 400;
