import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { clicksByLinkId } from "~/features/analytics/analytics-engine";
import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import { type UserSummary, getUsersByIds } from "~/features/auth/user.repository";
import { listCampaignChannels, listCampaignsForChaptersWithCounts } from "~/features/campaigns";
import { listDomainsForChapters } from "~/features/domains";
import { listAllAccessibleFolders } from "~/features/folders/folder-access.repository";
import {
  listLinksAccessibleByEmail,
  listLinksForChapter,
  listLinksForUser,
  listPublicLinks,
} from "~/features/links/link-queries";
import type { Link as DbLink } from "~/features/links/link-record";
import {
  listTagsForChapter,
  listTagsForLinks,
  listTagsForUser,
} from "~/features/tags/tag.repository";
import type { PageRequestArgs } from "~/http/request";

export async function loader(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const [
    personalLinks,
    chapterLinks,
    sharedLinks,
    publicLinks,
    userTags,
    chapterTags,
    campaigns,
    domains,
    folders,
  ] = await Promise.all([
    listLinksForUser(env.DB, user.id, true),
    listLinksForChapter(env.DB, chapter.chapterId, true),
    listLinksAccessibleByEmail(env.DB, user.email, chapter.chapterId, true),
    listPublicLinks(env.DB, true),
    listTagsForUser(env.DB, user.id),
    listTagsForChapter(env.DB, chapter.chapterId),
    listCampaignsForChaptersWithCounts(
      env.DB,
      chapters.map((item) => item.chapterId),
      true,
    ),
    listDomainsForChapters(
      env.DB,
      chapters.map((item) => item.chapterId),
    ),
    listAllAccessibleFolders(env.DB, {
      userId: user.id,
      email: user.email,
      chapterIds: chapters.map((item) => item.chapterId),
      isSuperAdmin: isSuperAdmin(user),
    }),
  ]);
  const ownLinks = [...personalLinks];
  const ownLinkIds = new Set(ownLinks.map((link) => link.id));
  for (const link of chapterLinks) {
    if (!ownLinkIds.has(link.id)) {
      ownLinks.push(link);
      ownLinkIds.add(link.id);
    }
  }
  const ownIds = new Set(ownLinks.map((l) => l.id));
  const sharedFromPerms = sharedLinks.filter((l) => !ownIds.has(l.id));
  const sharedIds = new Set(sharedFromPerms.map((l) => l.id));
  const sharedFromPublic = publicLinks.filter((l) => !ownIds.has(l.id) && !sharedIds.has(l.id));
  const sharedFiltered = [...sharedFromPerms, ...sharedFromPublic];
  const allLinks: DbLink[] = [...ownLinks, ...sharedFiltered];
  const ownerIds = [...new Set(allLinks.map((l) => l.ownerUserId))];
  const linkIds = allLinks.map((l) => l.id);

  // Analytics Engine is an external HTTP API and is consistently slower than D1.
  // Start it immediately, but stream the result so it never blocks the route transition.
  const clicks = clicksByLinkId(env, linkIds)
    .then((clickMap) => {
      const counts: Record<string, number> = {};
      for (const [id, count] of clickMap) counts[id] = count;
      return counts;
    })
    .catch((err) => {
      console.error("Analytics Engine query failed (clicksByLinkId):", err);
      return {} as Record<string, number>;
    });

  const [channelsByCampaign, owners, tagsByLinkId] = await Promise.all([
    Promise.all(
      campaigns.map(async (campaign) => ({
        campaign,
        channels: await listCampaignChannels(env.DB, campaign.id, true),
      })),
    ),
    ownerIds.length > 0
      ? getUsersByIds(env.DB, ownerIds).catch(() => ({}) as Record<string, UserSummary>)
      : Promise.resolve({} as Record<string, UserSummary>),
    listTagsForLinks(env.DB, linkIds),
  ]);

  return {
    user,
    chapter,
    chapters,
    ownLinks,
    sharedLinks: sharedFiltered,
    owners,
    tagsByLinkId,
    clicks,
    availableTags: [...userTags, ...chapterTags],
    campaignChannelCatalog: channelsByCampaign.flatMap(({ campaign, channels }) =>
      channels.map((channel) => ({
        id: channel.id,
        channelId: channel.id,
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignCode: campaign.code,
        campaignArchived: campaign.archivedAt !== null,
        channelName: channel.name,
        channelCode: channel.code,
        channelArchived: channel.archivedAt !== null,
      })),
    ),
    campaignChannelOptions: channelsByCampaign.flatMap(({ campaign, channels }) =>
      campaign.archivedAt === null
        ? channels
            .filter((channel) => channel.archivedAt === null)
            .map((channel) => ({
              id: channel.id,
              channelId: channel.id,
              campaignId: campaign.id,
              campaignName: campaign.name,
              campaignCode: campaign.code,
              defaultDestinationUrl: campaign.defaultDestinationUrl,
              channelName: channel.name,
              channelCode: channel.code,
            }))
        : [],
    ),
    shortUrlBase: env.SHORT_URL_BASE,
    domainOptions: domains
      .filter((domain) => domain.status === "active")
      .map((domain) => ({ id: domain.id, hostname: domain.hostname })),
    folders,
  };
}

export type DashboardPageData = Awaited<ReturnType<typeof loader>>;
export type DashboardPageAction = undefined;
