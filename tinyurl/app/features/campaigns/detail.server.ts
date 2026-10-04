import { isSuperAdmin } from "@gdgjp/gdg-lib";
import {
  type TopBlob,
  type TopRow,
  clicksByLinkId,
  clicksByLinkIdAndSource,
  granularityFor,
  granularityForTimeBucket,
  hourlyClicksByLinkIdAndSource,
  parseTimeBucket,
  timeBucketFor,
  timeBucketLabel,
  timeBucketParam,
  topByBlob,
  totalClicks,
} from "~/features/analytics/analytics-engine";
import {
  ACQUISITION_PERIOD_PARAMS,
  parseAnalyticsParams,
  parsePeriodParams,
} from "~/features/analytics/analytics-filters";
import type { FilterSuggestions } from "~/features/analytics/components/analytics/analytics-filter-button";
import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import { getUsersByIds } from "~/features/auth/user.repository";
import type { UserSummary } from "~/features/auth/user.repository";
import {
  archiveCampaignChannel,
  archiveCampaignChannelSource,
  createCampaignChannel,
  createCampaignChannelSource,
  getCampaignById,
  getCampaignWithChannelLinks,
  listCampaignChannelsWithLinks,
  updateCampaignChannel,
  updateCampaignChannelSource,
} from "~/features/campaigns";
import { campaignAcquisitionAnalytics } from "~/features/campaigns/campaign-acquisition";
import { campaignSourceBreakdown } from "~/features/campaigns/campaign-analytics";
import {
  assignLinksToChannel,
  listAssignableLinksForCampaign,
  listLatestCommentsForCampaign,
} from "~/features/campaigns/campaign-links.repository";
import { resolveCampaignScope } from "~/features/campaigns/campaign-navigation";
import {
  getCampaignParticipantAnalytics,
  replaceCampaignParticipantAnalytics,
} from "~/features/campaigns/campaign-participant-analytics-db";
import { buildCampaignParticipantAnalyticsInput } from "~/features/campaigns/campaign-participant-import.server";
import { listTagsForChapter, listTagsForUser } from "~/features/tags/tag.repository";
import type { PageRequestArgs } from "~/http/request";

export const CAMPAIGN_FILTER_DIMENSIONS = [
  "referer",
  "country",
  "city",
  "region",
  "continent",
  "device",
  "browser",
  "os",
] as const satisfies readonly TopBlob[];

export function filterSuggestionNames(rows: Awaited<ReturnType<typeof topByBlob>>): string[] {
  return rows.map((row) => row.name).filter((name) => name !== "(unknown)");
}

export function parseId(value: FormDataEntryValue | null, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Response(`Invalid ${label}.`, { status: 400 });
  return id;
}

export async function requireCampaignAccess(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const id = Number(args.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new Response("Not found", { status: 404 });
  const campaign = await getCampaignById(env.DB, id);
  if (!campaign) throw new Response("Not found", { status: 404 });
  const accessChapter = chapters.find((item) => campaign.chapterIds.includes(item.chapterId));
  if (!accessChapter && !isSuperAdmin(user)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { env, user, chapter: accessChapter ?? chapter, chapters, campaign, id };
}

export async function loader(args: PageRequestArgs) {
  const { env, user, chapter, chapters, campaign, id } = await requireCampaignAccess(args);
  const [channels, assignableLinks, userTags, chapterTags, participantSnapshot] = await Promise.all(
    [
      listCampaignChannelsWithLinks(env.DB, id, true),
      listAssignableLinksForCampaign(env.DB, {
        userId: user.id,
        email: user.email,
        chapterIds: chapters.map((item) => item.chapterId),
        campaignId: id,
      }),
      listTagsForUser(env.DB, user.id),
      listTagsForChapter(env.DB, chapter.chapterId),
      getCampaignParticipantAnalytics(env.DB, id),
    ],
  );
  const ownerIds = [
    ...new Set(channels.flatMap((item) => item.links.map((link) => link.ownerUserId))),
  ];
  const [owners, latestCommentRecords] = await Promise.all([
    ownerIds.length > 0
      ? getUsersByIds(env.DB, ownerIds).catch(() => ({}) as Record<string, UserSummary>)
      : {},
    listLatestCommentsForCampaign(env.DB, id),
  ]);
  const latestComments = Object.fromEntries(
    Object.entries(latestCommentRecords).map(([linkId, comment]) => [linkId, comment.body]),
  );
  const url = new URL(args.request.url);
  const parsed = parseAnalyticsParams(url.searchParams);
  const acquisitionPeriod = parsePeriodParams(url.searchParams, ACQUISITION_PERIOD_PARAMS, "all");
  const acquisitionBucket = parseTimeBucket(url.searchParams.get("acquisitionBucket"));
  const requestedBucket = parseTimeBucket(url.searchParams.get("bucket"));
  const effectiveBucket = requestedBucket ?? timeBucketFor(parsed.window);
  const { selectedChannelId, selectedLinkId } = resolveCampaignScope(channels, url.searchParams);
  const channelsInScope = selectedChannelId
    ? channels.filter((item) => item.id === selectedChannelId)
    : channels;
  const linkIds = channelsInScope.flatMap((item) =>
    item.links
      .filter((link) => !selectedLinkId || link.id === selectedLinkId)
      .map((link) => link.id),
  );
  const opts = {
    window: parsed.window,
    filters: parsed.filters,
    bucket: requestedBucket ?? undefined,
    includeAutomated: parsed.includeAutomated,
  };
  const fallback =
    <T>(label: string, value: T) =>
    (error: unknown): T => {
      console.error(`Campaign analytics query failed (${label}):`, error);
      return value;
    };
  const emptyClicks = new Map<string, number>();
  const clickMap =
    linkIds.length === 0
      ? Promise.resolve(emptyClicks)
      : clicksByLinkId(env, linkIds, opts).catch(fallback("links", emptyClicks));
  const clicks = clickMap.then((resolved) => {
    const counts: Record<string, number> = {};
    for (const [linkId, count] of resolved) counts[linkId] = count;
    return counts;
  });
  const dimensionRows =
    linkIds.length === 0
      ? Promise.resolve([] as Array<readonly [TopBlob, TopRow[]]>)
      : Promise.all(
          CAMPAIGN_FILTER_DIMENSIONS.map(async (dimension) => {
            const rows = await topByBlob(env, dimension, linkIds, 10, opts).catch(
              fallback(`filter:${dimension}`, []),
            );
            return [dimension, rows] as const;
          }),
        );
  const analytics = Promise.all([
    linkIds.length === 0
      ? Promise.resolve(0)
      : totalClicks(env, linkIds, opts).catch(fallback("total", 0)),
    clicks,
    linkIds.length === 0
      ? Promise.resolve([])
      : clicksByLinkIdAndSource(env, linkIds, opts).catch(fallback("sources", [])),
    linkIds.length === 0
      ? Promise.resolve([])
      : hourlyClicksByLinkIdAndSource(env, linkIds, opts).catch(fallback("trends", [])),
    dimensionRows,
  ]).then(([total, resolvedClicks, sourceClicks, trend, dimensions]) => {
    const sourceBreakdown = campaignSourceBreakdown(channelsInScope, sourceClicks);
    const breakdowns: Record<TopBlob, TopRow[]> = {
      slug: [],
      country: [],
      region: [],
      city: [],
      continent: [],
      referer: [],
      browser: [],
      os: [],
      device: [],
      source: [],
      ...Object.fromEntries(dimensions),
    };
    const sourceSuggestions = new Set(
      channelsInScope.flatMap((item) => item.sources.map((source) => source.code)),
    );
    for (const row of sourceClicks) if (row.source) sourceSuggestions.add(row.source);
    const suggestions: FilterSuggestions = {
      ...Object.fromEntries(
        Object.entries(breakdowns).map(([dimension, rows]) => [
          dimension,
          filterSuggestionNames(rows),
        ]),
      ),
      source: [...sourceSuggestions].sort(),
      slug: channelsInScope.flatMap((item) => item.links.map((link) => link.slug)),
    };
    return {
      total,
      trend,
      clicks: resolvedClicks,
      topSources: sourceBreakdown.rows,
      unregisteredSources: sourceBreakdown.unregistered,
      referrers: breakdowns.referer,
      countries: breakdowns.country,
      cities: breakdowns.city,
      regions: breakdowns.region,
      continents: breakdowns.continent,
      devices: breakdowns.device,
      browsers: breakdowns.browser,
      oses: breakdowns.os,
      granularity: requestedBucket
        ? granularityForTimeBucket(requestedBucket)
        : granularityFor(parsed.window),
      bucketLabel: timeBucketLabel(effectiveBucket),
      suggestions,
    };
  });

  const acquisition = participantSnapshot
    ? campaignAcquisitionAnalytics({
        snapshot: participantSnapshot,
        channels,
        window: acquisitionPeriod.window,
        bucket: acquisitionBucket ?? undefined,
      })
    : null;

  return {
    chapters,
    user: { email: user.email, image: user.image, name: user.name },
    campaign,
    channels,
    owners,
    latestComments,
    assignableLinks,
    availableTags: [...userTags, ...chapterTags],
    shortUrlBase: env.SHORT_URL_BASE,
    selectedChannelId,
    selectedLinkId,
    preset: parsed.preset,
    customStart: parsed.window.kind === "custom" ? parsed.window.startIso : undefined,
    customEnd: parsed.window.kind === "custom" ? parsed.window.endIso : undefined,
    filters: parsed.filters,
    bucket: requestedBucket ? timeBucketParam(requestedBucket) : "",
    acquisitionPreset: acquisitionPeriod.preset,
    acquisitionStart:
      acquisitionPeriod.window.kind === "custom" ? acquisitionPeriod.window.startIso : undefined,
    acquisitionEnd:
      acquisitionPeriod.window.kind === "custom" ? acquisitionPeriod.window.endIso : undefined,
    acquisitionBucket: acquisitionBucket ? timeBucketParam(acquisitionBucket) : "",
    participantSnapshot,
    acquisition,
    clicks,
    analytics,
  };
}

export async function action(args: PageRequestArgs) {
  const { env, user, chapter, chapters, campaign, id } = await requireCampaignAccess(args);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "replaceParticipantAnalytics") {
    const connpassEventId = String(form.get("connpassEventId") ?? "").trim();
    if (!/^\d+$/.test(connpassEventId)) {
      return { error: "Enter a numeric connpass event ID." };
    }
    const campaignChannels = await listCampaignChannelsWithLinks(env.DB, id, false);
    try {
      const input = buildCampaignParticipantAnalyticsInput({
        rawDraft: String(form.get("draft") ?? ""),
        campaignId: id,
        connpassEventId,
        importedByUserId: user.id,
        allowedChannelIds: campaignChannels.map((channel) => channel.id),
      });
      await replaceCampaignParticipantAnalytics(env.DB, input);
      return { ok: true };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "The registration import is invalid.",
      };
    }
  }

  if (intent === "createChannel") {
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    if (!name || name.length > 64) return { error: "Channel name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(code)) return { error: "Invalid channel code." };
    const result = await createCampaignChannel(env.DB, { campaignId: id, name, code });
    if (!result.ok) return { error: `Channel code “${code}” is already in use.` };
    return { ok: true };
  }

  if (intent === "createSource" || intent === "registerSource") {
    const channelId = parseId(form.get("channelId"), "channel");
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    const belongs = (await getCampaignWithChannelLinks(env.DB, id))?.channels.some(
      (item) => item.id === channelId,
    );
    if (!belongs) throw new Response("Forbidden", { status: 403 });
    if (!name || name.length > 64) return { error: "Source name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) return { error: "Invalid source code." };
    const result = await createCampaignChannelSource(env.DB, { channelId, name, code });
    if (!result.ok) return { error: `Source code “${code}” is already registered.` };
    return { ok: true };
  }

  if (intent === "updateChannel") {
    const channelId = parseId(form.get("channelId"), "channel");
    const tree = await getCampaignWithChannelLinks(env.DB, id, true);
    if (!tree?.channels.some((item) => item.id === channelId)) {
      throw new Response("Forbidden", { status: 403 });
    }
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    const sortOrder = Number(form.get("sortOrder"));
    if (!name || name.length > 64) return { error: "Channel name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(code)) return { error: "Invalid channel code." };
    if (!Number.isInteger(sortOrder)) return { error: "Sort order must be an integer." };
    const result = await updateCampaignChannel(env.DB, channelId, { name, code, sortOrder });
    if (result && !result.ok) return { error: `Channel code “${code}” is already in use.` };
    return { ok: true };
  }

  if (intent === "updateSource") {
    const sourceId = parseId(form.get("sourceId"), "source");
    const tree = await getCampaignWithChannelLinks(env.DB, id, true);
    if (!tree?.channels.some((item) => item.sources.some((source) => source.id === sourceId))) {
      throw new Response("Forbidden", { status: 403 });
    }
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    if (!name || name.length > 64) return { error: "Source name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) return { error: "Invalid source code." };
    const result = await updateCampaignChannelSource(env.DB, sourceId, { name, code });
    if (result && !result.ok) return { error: `Source code “${code}” is already registered.` };
    return { ok: true };
  }

  if (intent === "assign") {
    const channelId = parseId(form.get("channelId"), "channel");
    const linkIds = form.getAll("linkId").map(String);
    if (linkIds.length === 0) return { error: "Select at least one link." };
    const tree = await getCampaignWithChannelLinks(env.DB, id);
    if (!tree?.channels.some((item) => item.id === channelId)) {
      throw new Response("Forbidden", { status: 403 });
    }
    const result = await assignLinksToChannel(env.DB, {
      linkIds,
      channelId,
      actorUserId: user.id,
      actorEmail: user.email,
      actorChapterId: chapter.chapterId,
      actorChapterIds: chapters.map((item) => item.chapterId),
    });
    if (result.assignedIds.length === 0)
      return { error: "The selected links could not be assigned." };
    if (result.rejectedIds.length > 0) {
      return { error: `${result.rejectedIds.length} link(s) could not be assigned.` };
    }
    return { ok: true };
  }

  if (intent === "archiveChannel" || intent === "restoreChannel") {
    const channelId = parseId(form.get("channelId"), "channel");
    const belongs = (await getCampaignWithChannelLinks(env.DB, id, true))?.channels.some(
      (item) => item.id === channelId,
    );
    if (!belongs) throw new Response("Forbidden", { status: 403 });
    await archiveCampaignChannel(env.DB, channelId, intent === "archiveChannel");
    return { ok: true };
  }

  if (intent === "archiveSource" || intent === "restoreSource") {
    const sourceId = parseId(form.get("sourceId"), "source");
    const belongs = (await getCampaignWithChannelLinks(env.DB, id, true))?.channels.some((item) =>
      item.sources.some((source) => source.id === sourceId),
    );
    if (!belongs) throw new Response("Forbidden", { status: 403 });
    await archiveCampaignChannelSource(env.DB, sourceId, intent === "archiveSource");
    return { ok: true };
  }

  return { error: `Unknown action for ${campaign.name}.` };
}

export type CampaignsPageData = Awaited<ReturnType<typeof loader>>;
export type CampaignsPageAction = Awaited<ReturnType<typeof action>>;
