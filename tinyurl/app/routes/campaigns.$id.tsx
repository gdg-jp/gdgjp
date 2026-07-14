import { isSuperAdmin } from "@gdgjp/gdg-lib";
import {
  Archive,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  Link2,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  Users,
  X,
} from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Await, Form, Link, useLocation, useNavigation, useSearchParams } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import {
  AnalyticsBarListCard,
  AnalyticsBarListSkeleton,
  AnalyticsClicksChartCard,
  AnalyticsDimensionCards,
} from "~/components/analytics/analytics-breakdown-cards";
import type { FilterSuggestions } from "~/components/analytics/analytics-filter-button";
import { AnalyticsFiltersBar } from "~/components/analytics/analytics-filters-bar";
import { CampaignConversionAttributionPanel } from "~/components/campaigns/conversion-attribution";
import {
  type CampaignChannelOption,
  CampaignParticipantImportWizard,
  type ConnpassImportDraft,
} from "~/components/campaigns/participant-import-wizard";
import { useCampaignActionDialog } from "~/components/campaigns/use-campaign-action-dialog";
import { CampaignTrendChart, type TrendMetric } from "~/components/charts/campaign-trend-chart";
import { CreateLinkDialog } from "~/components/create-link-dialog";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import { LinkCard } from "~/components/link-card";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { SubmitButton } from "~/components/ui/submit-button";
import {
  type TimeBucketUnit,
  type TopBlob,
  type TopRow,
  clicksByLinkId,
  clicksByLinkIdAndSource,
  conversionClicksByHour,
  granularityFor,
  granularityForTimeBucket,
  hourlyClicksByLinkIdAndSource,
  parseTimeBucket,
  timeBucketFor,
  timeBucketLabel,
  timeBucketParam,
  topByBlob,
  totalClicks,
} from "~/lib/analytics-engine";
import { parseAnalyticsParams } from "~/lib/analytics-filters";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { type CampaignTrendDimension, campaignSourceBreakdown } from "~/lib/campaign-analytics";
import { campaignConversionAttribution } from "~/lib/campaign-conversion-attribution";
import { resolveCampaignScope, shouldReloadCampaign } from "~/lib/campaign-navigation";
import {
  getCampaignParticipantAnalytics,
  replaceCampaignParticipantAnalytics,
} from "~/lib/campaign-participant-analytics-db";
import { buildCampaignParticipantAnalyticsInput } from "~/lib/campaign-participant-import.server";
import {
  archiveCampaignChannel,
  archiveCampaignChannelSource,
  assignLinksToChannel,
  createCampaignChannel,
  createCampaignChannelSource,
  getCampaignById,
  getCampaignWithChannelLinks,
  getUsersByIds,
  listAssignableLinksForCampaign,
  listCampaignChannelsWithLinks,
  listLatestCommentsForCampaign,
  listTagsForChapter,
  listTagsForUser,
  updateCampaignChannel,
  updateCampaignChannelSource,
} from "~/lib/db";
import type { UserSummary } from "~/lib/db";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/campaigns.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.campaign.name ?? "Campaign"} — GDG Japan Links` }];
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return shouldReloadCampaign(currentUrl, nextUrl, defaultShouldRevalidate);
}

const CAMPAIGN_FILTER_DIMENSIONS = [
  "referer",
  "country",
  "city",
  "region",
  "continent",
  "device",
  "browser",
  "os",
] as const satisfies readonly TopBlob[];

function filterSuggestionNames(rows: Awaited<ReturnType<typeof topByBlob>>): string[] {
  return rows.map((row) => row.name).filter((name) => name !== "(unknown)");
}

function parseId(value: FormDataEntryValue | null, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Response(`Invalid ${label}.`, { status: 400 });
  return id;
}

async function requireCampaignAccess(args: Route.LoaderArgs | Route.ActionArgs) {
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

export async function loader(args: Route.LoaderArgs) {
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
  };
  const fallback =
    <T,>(label: string, value: T) =>
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
    linkIds.length === 0
      ? Promise.resolve([])
      : conversionClicksByHour(env, linkIds, opts).catch(fallback("conversion", [])),
    dimensionRows,
  ]).then(([total, resolvedClicks, sourceClicks, trend, conversionClicks, dimensions]) => {
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
      conversion: participantSnapshot
        ? campaignConversionAttribution({
            snapshot: participantSnapshot,
            channels: channelsInScope,
            clicks: conversionClicks,
            window: parsed.window,
          })
        : null,
    };
  });

  return {
    chapters,
    user: { email: user.email, name: user.name },
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
    clicks,
    analytics,
  };
}

export async function action(args: Route.ActionArgs) {
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

export default function CampaignDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    campaign,
    channels,
    latestComments,
    owners,
    assignableLinks,
    availableTags,
    chapters,
    shortUrlBase,
    selectedChannelId: loadedChannelId,
    selectedLinkId: loadedLinkId,
    preset,
    customStart,
    customEnd,
    filters,
    bucket,
    clicks,
    analytics,
  } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigation = useNavigation();
  const navigatingWithinCampaign = navigation.location?.pathname === location.pathname;
  // The loader already contains every channel's D1 link tree. During a scoped AE reload,
  // use the destination URL with that cached tree so link controls update immediately.
  const scopeSearchParams = navigatingWithinCampaign
    ? new URLSearchParams(navigation.location?.search)
    : searchParams;
  const { selectedChannelId, selectedLinkId } = resolveCampaignScope(channels, scopeSearchParams);
  const scopePending =
    navigatingWithinCampaign &&
    (selectedChannelId !== loadedChannelId || selectedLinkId !== loadedLinkId);
  const activeView = searchParams.get("view") === "analytics" ? "analytics" : "channels";
  const analyticsPending =
    navigatingWithinCampaign &&
    (activeView === "analytics" ||
      new URLSearchParams(navigation.location?.search).get("view") === "analytics");
  const activeChannels = channels.filter((item) => item.archivedAt === null);

  function setView(view: "channels" | "analytics") {
    const next = new URLSearchParams(searchParams);
    if (view === "analytics") next.set("view", "analytics");
    else next.delete("view");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <DashboardShell user={user}>
      <DashboardPage>
        {actionData && "error" in actionData ? (
          <Alert variant="destructive">
            <AlertDescription>{actionData.error}</AlertDescription>
          </Alert>
        ) : null}
        <DashboardPageHeader
          title={campaign.name}
          description="Channel, links, and source performance"
          titleAccessory={
            <Badge variant="outline" className="shrink-0 font-mono">
              {campaign.code}
            </Badge>
          }
          eyebrow={
            <Link
              to="/campaigns"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" /> Campaigns
            </Link>
          }
          actions={
            <>
              <AssignLinksDialog channels={activeChannels} links={assignableLinks} />
              <CreateChannelDialog campaignCode={campaign.code} />
              <ImportConnpassDialog channels={activeChannels} />
            </>
          }
        />

        <div
          className="relative grid w-full grid-cols-2 rounded-lg bg-muted p-1 sm:w-fit"
          role="tablist"
          aria-label="Campaign view"
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-background shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none",
              activeView === "analytics" && "translate-x-full",
            )}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            role="tab"
            id="channels-tab"
            aria-selected={activeView === "channels"}
            aria-controls="channels-panel"
            onClick={() => setView("channels")}
            className={cn(
              "relative z-10 min-w-24 transition-colors duration-200 aria-selected:hover:bg-transparent",
              activeView === "channels" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Channel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            role="tab"
            id="analytics-tab"
            aria-selected={activeView === "analytics"}
            aria-controls="analytics-panel"
            onClick={() => setView("analytics")}
            className={cn(
              "relative z-10 min-w-24 transition-colors duration-200 aria-selected:hover:bg-transparent",
              activeView === "analytics" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Analytics
          </Button>
        </div>

        {activeView === "channels" ? (
          <section
            id="channels-panel"
            role="tabpanel"
            aria-labelledby="channels-tab"
            className="space-y-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1 motion-safe:duration-200"
          >
            <div className="flex items-center justify-between">
              <h2 id="channels-heading" className="text-lg font-semibold">
                Channels
              </h2>
              <span className="text-sm text-muted-foreground">{channels.length} channels</span>
            </div>
            {channels.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                Add a channel such as X, Discord, or Instagram.
              </div>
            ) : (
              <Suspense fallback={<CampaignPanelSkeleton rows={channels.length} />}>
                <Await resolve={clicks}>
                  {(resolvedClicks) =>
                    channels.map((item) => (
                      <ChannelCard
                        key={item.id}
                        campaign={campaign}
                        channel={item}
                        owners={owners}
                        availableTags={availableTags}
                        chapters={chapters}
                        shortUrlBase={shortUrlBase}
                        clicks={resolvedClicks}
                      />
                    ))
                  }
                </Await>
              </Suspense>
            )}
          </section>
        ) : (
          <Suspense fallback={<CampaignAnalyticsSkeleton />}>
            <Await resolve={analytics}>
              {(resolvedAnalytics) => (
                <CampaignAnalyticsPanel
                  analytics={resolvedAnalytics}
                  channels={channels}
                  latestComments={latestComments}
                  selectedChannelId={selectedChannelId}
                  selectedLinkId={selectedLinkId}
                  shortUrlBase={shortUrlBase}
                  preset={preset}
                  customStart={customStart}
                  customEnd={customEnd}
                  filters={filters}
                  bucket={bucket}
                  scopeSearchParams={scopeSearchParams}
                  scopePending={scopePending}
                  analyticsPending={analyticsPending}
                />
              )}
            </Await>
          </Suspense>
        )}
      </DashboardPage>
    </DashboardShell>
  );
}

function CampaignPanelSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading campaign statistics">
      {["first", "second", "third"].slice(0, Math.max(1, Math.min(rows, 3))).map((key) => (
        <Skeleton key={key} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}

function CampaignAnalyticsSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading campaign analytics">
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-80 w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

function CampaignGraphInterval({ value, pending }: { value: string; pending: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = parseTimeBucket(value);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [unit, setUnit] = useState<TimeBucketUnit>(initial?.unit ?? "hour");
  const [error, setError] = useState("");

  useEffect(() => {
    const parsed = parseTimeBucket(value);
    setAmount(parsed ? String(parsed.amount) : "");
    setUnit(parsed?.unit ?? "hour");
    setError("");
  }, [value]);

  function applyInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (
      amount &&
      (!Number.isInteger(numericAmount) || numericAmount <= 0 || numericAmount > 9999)
    ) {
      setError("Enter a whole number from 1 to 9999.");
      return;
    }

    const next = new URLSearchParams(searchParams);
    if (amount) next.set("bucket", timeBucketParam({ amount: numericAmount, unit }));
    else next.delete("bucket");
    setError("");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <form className="ml-2 flex flex-wrap items-center gap-1.5" onSubmit={applyInterval}>
      <Label htmlFor="campaign-graph-interval" className="text-xs text-muted-foreground">
        Interval
      </Label>
      <Input
        id="campaign-graph-interval"
        type="number"
        inputMode="numeric"
        min={1}
        max={9999}
        step={1}
        value={amount}
        onChange={(event) => {
          setAmount(event.target.value);
          setError("");
        }}
        placeholder="Auto"
        aria-label="Graph interval amount"
        aria-invalid={Boolean(error)}
        disabled={pending}
        className="h-[30px] w-[60px] px-2 font-mono text-xs shadow-none"
      />
      <Select
        value={unit}
        onValueChange={(nextUnit) => setUnit(nextUnit as TimeBucketUnit)}
        disabled={pending}
      >
        <SelectTrigger
          size="sm"
          aria-label="Graph interval unit"
          className="w-20 px-2 text-xs shadow-none data-[size=sm]:h-[30px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="minute">Minutes</SelectItem>
          <SelectItem value="hour">Hours</SelectItem>
          <SelectItem value="day">Days</SelectItem>
          <SelectItem value="week">Weeks</SelectItem>
        </SelectContent>
      </Select>
      <Button
        type="submit"
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        aria-label="Apply graph interval"
        title="Apply interval"
      >
        <Check className="size-3" />
      </Button>
      {value ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          aria-label="Reset graph interval to automatic"
          title="Use automatic interval"
          onClick={() => {
            setAmount("");
            const next = new URLSearchParams(searchParams);
            next.delete("bucket");
            setSearchParams(next, { preventScrollReset: true });
          }}
        >
          <RotateCcw className="size-3" />
        </Button>
      ) : null}
      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
    </form>
  );
}

function CampaignAnalyticsPanel({
  analytics,
  channels,
  latestComments,
  selectedChannelId,
  selectedLinkId,
  shortUrlBase,
  preset,
  customStart,
  customEnd,
  filters,
  bucket,
  scopeSearchParams,
  scopePending,
  analyticsPending,
}: {
  analytics: Awaited<Route.ComponentProps["loaderData"]["analytics"]>;
  channels: DetailChannel[];
  latestComments: Route.ComponentProps["loaderData"]["latestComments"];
  selectedChannelId: number | null;
  selectedLinkId: string | null;
  shortUrlBase: string;
  preset: Route.ComponentProps["loaderData"]["preset"];
  customStart: string | undefined;
  customEnd: string | undefined;
  filters: Route.ComponentProps["loaderData"]["filters"];
  bucket: string;
  scopeSearchParams: URLSearchParams;
  scopePending: boolean;
  analyticsPending: boolean;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [breakdown, setBreakdown] = useState<CampaignTrendDimension>("total");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("clicks");
  const [graphFocus, setGraphFocus] = useState<{ key: string; label: string } | null>(null);
  const channelsInScope = selectedChannelId
    ? channels.filter((item) => item.id === selectedChannelId)
    : channels;
  const linkRows = channelsInScope
    .flatMap((item) => item.links)
    .filter((link) => !selectedLinkId || link.id === selectedLinkId)
    .map((link) => ({
      key: `link:${link.id}`,
      name: `${shortUrlBase}/${link.slug}`,
      description: latestComments[link.id],
      clicks: analytics.clicks[link.id] ?? 0,
    }))
    .sort((a, b) => b.clicks - a.clicks);
  const channelRows = channelsInScope
    .map((item) => ({
      key: `channel:${item.id}`,
      name: item.name,
      clicks: item.links.reduce((sum, link) => sum + (analytics.clicks[link.id] ?? 0), 0),
    }))
    .sort((a, b) => b.clicks - a.clicks);

  function selectGraphItem(
    dimension: Exclude<CampaignTrendDimension, "total">,
    row: { key?: string; name: string },
  ) {
    if (!row.key) return;
    setBreakdown(dimension);
    setTrendMetric("clicks");
    setGraphFocus({ key: row.key, label: row.name });
    requestAnimationFrame(() =>
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  }

  function changeBreakdown(value: CampaignTrendDimension) {
    setBreakdown(value);
    setGraphFocus(null);
    if (value === "total") setTrendMetric("clicks");
  }

  return (
    <div
      id="analytics-panel"
      role="tabpanel"
      aria-labelledby="analytics-tab"
      className="space-y-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-1 motion-safe:duration-200"
    >
      <section aria-labelledby="analytics-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="analytics-heading" className="flex items-center gap-2 text-lg font-semibold">
            <BarChart3 className="size-5" /> Analytics
          </h2>
          <AnalyticsFiltersBar
            preset={preset}
            startIso={customStart}
            endIso={customEnd}
            filters={filters}
            suggestions={analytics.suggestions}
          />
        </div>
        <CampaignScopeFilters
          channels={channels}
          selectedChannelId={selectedChannelId}
          selectedLinkId={selectedLinkId}
          shortUrlBase={shortUrlBase}
          searchParams={scopeSearchParams}
          pending={scopePending}
        />
        <AnalyticsClicksChartCard ref={chartRef} total={analytics.total} pending={analyticsPending}>
          {analyticsPending ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <CampaignTrendChart
              rows={analytics.trend}
              channels={channelsInScope}
              height={260}
              granularity={analytics.granularity}
              bucketLabel={analytics.bucketLabel}
              intervalControl={<CampaignGraphInterval value={bucket} pending={analyticsPending} />}
              breakdown={breakdown}
              metric={trendMetric}
              focusKey={graphFocus?.key}
              focusLabel={graphFocus?.label}
              onBreakdownChange={changeBreakdown}
              onMetricChange={setTrendMetric}
              onClearFocus={() => setGraphFocus(null)}
            />
          )}
        </AnalyticsClicksChartCard>
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          <AnalyticsBarListCard
            title="Channel"
            description="Select a row to isolate its trend."
            rows={channelRows}
            loading={analyticsPending}
            loadingContent={<AnalyticsBarListSkeleton />}
            selectedKey={breakdown === "channel" ? graphFocus?.key : undefined}
            onSelect={(row) => selectGraphItem("channel", row)}
          />
          <AnalyticsBarListCard
            title="Sources"
            description="Select a row to isolate its trend."
            rows={analytics.topSources}
            emptyLabel="No source data yet."
            loading={analyticsPending}
            loadingContent={<AnalyticsBarListSkeleton />}
            selectedKey={breakdown === "source" ? graphFocus?.key : undefined}
            onSelect={(row) => selectGraphItem("source", row)}
          />
          <AnalyticsBarListCard
            title="Links"
            description="Select a row to isolate its trend."
            rows={linkRows}
            pending={scopePending}
            loading={analyticsPending}
            loadingContent={<AnalyticsBarListSkeleton />}
            selectedKey={breakdown === "link" ? graphFocus?.key : undefined}
            onSelect={(row) => selectGraphItem("link", row)}
          />
        </div>
        <AnalyticsDimensionCards analytics={analytics} />
        <CampaignConversionAttributionPanel analytics={analytics.conversion} />
      </section>

      {analytics.unregisteredSources.length > 0 ? (
        <Card className="border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/10">
          <CardHeader>
            <CardTitle className="text-sm">Unregistered sources detected</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {analytics.unregisteredSources.map((source) => (
              <div
                key={`${source.channelId}:${source.code}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
              >
                <div>
                  <code className="text-sm">
                    {source.channelName} / {source.code}
                  </code>
                  <span className="ml-2 text-xs text-muted-foreground">{source.clicks} clicks</span>
                </div>
                {channels.find((item) => item.id === source.channelId)?.archivedAt === null ? (
                  <RegisterSourceDialog
                    code={source.code}
                    channelId={source.channelId}
                    channelName={source.channelName}
                  />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

async function analyzeParticipantFile(
  file: File,
  channels: CampaignChannelOption[],
): Promise<ConnpassImportDraft> {
  const { analyzeConnpassParticipantsFile } = await import(
    "~/lib/campaign-participant-import.client"
  );
  return analyzeConnpassParticipantsFile(file, channels);
}

type DetailChannel = Route.ComponentProps["loaderData"]["channels"][number];
type AssignableLink = Route.ComponentProps["loaderData"]["assignableLinks"][number];
type DetailCampaign = Route.ComponentProps["loaderData"]["campaign"];
type AvailableTag = Route.ComponentProps["loaderData"]["availableTags"][number];

function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

function CampaignScopeFilters({
  channels,
  selectedChannelId,
  selectedLinkId,
  shortUrlBase,
  searchParams,
  pending,
}: {
  channels: DetailChannel[];
  selectedChannelId: number | null;
  selectedLinkId: string | null;
  shortUrlBase: string;
  searchParams: URLSearchParams;
  pending: boolean;
}) {
  const [, setSearchParams] = useSearchParams();
  const links = (
    selectedChannelId ? channels.filter((item) => item.id === selectedChannelId) : channels
  ).flatMap((item) => item.links.map((link) => ({ ...link, channelName: item.name })));

  function setScope(name: "channelId" | "linkId", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "channelId") next.delete("linkId");
    setSearchParams(next, { preventScrollReset: true });
  }

  function clearScope() {
    const next = new URLSearchParams(searchParams);
    next.delete("channelId");
    next.delete("linkId");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div
      className="flex min-w-0 flex-col items-stretch gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-end"
      aria-busy={pending || undefined}
    >
      <div className="min-w-0 space-y-1 sm:min-w-48">
        <Label htmlFor="analytics-channels">Channel</Label>
        <select
          id="analytics-channels"
          value={selectedChannelId ?? ""}
          onChange={(event) => setScope("channelId", event.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All channels</option>
          {channels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.archivedAt !== null ? " (Archived)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 flex-1 space-y-1 sm:min-w-56">
        <Label htmlFor="analytics-link">Link</Label>
        <select
          id="analytics-link"
          value={selectedLinkId ?? ""}
          onChange={(event) => setScope("linkId", event.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All links</option>
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.channelName} / {shortUrlBase}/{link.slug}
            </option>
          ))}
        </select>
      </div>
      {selectedChannelId || selectedLinkId ? (
        <Button type="button" variant="ghost" size="sm" onClick={clearScope}>
          <X className="size-4" /> Clear scope
        </Button>
      ) : null}
    </div>
  );
}

function ChannelCard({
  campaign,
  channel,
  owners,
  availableTags,
  chapters,
  shortUrlBase,
  clicks,
}: {
  campaign: DetailCampaign;
  channel: DetailChannel;
  owners: Record<string, UserSummary>;
  availableTags: AvailableTag[];
  chapters: Route.ComponentProps["loaderData"]["chapters"];
  shortUrlBase: string;
  clicks: Record<string, number>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Radio className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="font-medium">{channel.name}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{channel.code}</span>
            {channel.archivedAt !== null ? (
              <Badge variant="secondary" className="ml-2">
                Archived
              </Badge>
            ) : null}
            <span className="block text-xs text-muted-foreground">
              {channel.links.length} links · {channel.sources.length} sources
            </span>
          </span>
          <ChevronDown
            className={`ml-auto size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          {channel.archivedAt === null ? (
            <>
              <CreateSourceDialog channelId={channel.id} />
              <CreateLinkDialog
                availableTags={availableTags}
                defaultCampaignChannelId={channel.id}
                campaignChannelOptions={[
                  {
                    id: channel.id,
                    campaignName: campaign.name,
                    campaignCode: campaign.code,
                    defaultDestinationUrl: campaign.defaultDestinationUrl,
                    channelName: channel.name,
                    channelCode: channel.code,
                  },
                ]}
                chapters={chapters}
                shortUrlBase={shortUrlBase}
                trigger={
                  <Button size="sm">
                    <Link2 className="size-4" />
                    Create link
                  </Button>
                }
              />
            </>
          ) : null}
          <EditChannelDialog channel={channel} />
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value={channel.archivedAt === null ? "archiveChannel" : "restoreChannel"}
            />
            <input type="hidden" name="channelId" value={channel.id} />
            <Button type="submit" size="icon" variant="ghost">
              {channel.archivedAt === null ? (
                <Archive className="size-4" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              <span className="sr-only">
                {channel.archivedAt === null ? "Archive" : "Restore"} {channel.name}
              </span>
            </Button>
          </Form>
        </div>
      </div>
      {open ? (
        <div className="min-w-0 border-t px-3 py-4 sm:px-5">
          {channel.sources.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {channel.sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center rounded-md border bg-muted/50 pl-2"
                >
                  <Users className="mr-1 size-3" />
                  <span className="text-xs">
                    {source.name} <code>{source.code}</code>
                  </span>
                  {source.archivedAt !== null ? (
                    <Badge variant="secondary" className="ml-1 text-[10px]">
                      Archived
                    </Badge>
                  ) : null}
                  <EditSourceDialog source={source} />
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value={source.archivedAt === null ? "archiveSource" : "restoreSource"}
                    />
                    <input type="hidden" name="sourceId" value={source.id} />
                    <Button type="submit" size="icon" variant="ghost" className="size-7">
                      {source.archivedAt === null ? (
                        <Archive className="size-3" />
                      ) : (
                        <RotateCcw className="size-3" />
                      )}
                      <span className="sr-only">
                        {source.archivedAt === null ? "Archive" : "Restore"} {source.name}
                      </span>
                    </Button>
                  </Form>
                </div>
              ))}
            </div>
          ) : null}
          {channel.links.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">No links assigned yet.</p>
          ) : (
            <div className="space-y-3">
              {channel.links.map((link) => (
                <div key={link.id}>
                  <LinkCard
                    item={{
                      link,
                      owner: owners[link.ownerUserId] ?? {
                        id: link.ownerUserId,
                        name: "",
                        email: "",
                      },
                      clicks: clicks[link.id] ?? 0,
                      campaign: {
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                        campaignCode: campaign.code,
                        channelId: channel.id,
                        channelName: channel.name,
                        channelCode: channel.code,
                      },
                    }}
                    shortUrlBase={shortUrlBase}
                    shortHost={shortHostOf(shortUrlBase)}
                    sources={channel.sources.filter((source) => source.archivedAt === null)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function CreateChannelDialog({ campaignCode }: { campaignCode: string }) {
  return (
    <SimpleCreateDialog
      title="Add channel"
      description={`Create a channel under ${campaignCode}.`}
      triggerLabel="Add channel"
      intent="createChannel"
      codePlaceholder="x"
    />
  );
}

function ImportConnpassDialog({ channels }: { channels: DetailChannel[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> Import connpass CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b">
          <DialogTitle>Import connpass CSV</DialogTitle>
          <DialogDescription>
            Extract registration dates and map each questionnaire option to one Campaign channel.
          </DialogDescription>
        </DialogHeader>
        <CampaignParticipantImportWizard
          analyzeFile={analyzeParticipantFile}
          channels={channels.map(({ id, name, code }) => ({ id, name, code }))}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateSourceDialog({ channelId }: { channelId: number }) {
  return (
    <SimpleCreateDialog
      title="Add source"
      description="Register a recurring distribution target."
      triggerLabel="Source"
      intent="createSource"
      namePlaceholder="GDG Tokyo"
      codePlaceholder="1"
      hidden={{ channelId }}
    />
  );
}

function EditChannelDialog({ channel }: { channel: DetailChannel }) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost">
          <Pencil className="size-4" />
          <span className="sr-only">Edit {channel.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b">
          <DialogTitle>Edit channel</DialogTitle>
          <DialogDescription>Change its label, code, or campaign ordering.</DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="updateChannel" />
          <input type="hidden" name="channelId" value={channel.id} />
          <div className="space-y-2">
            <Label htmlFor={`edit-channel-name-${channel.id}`}>Display name</Label>
            <Input
              id={`edit-channel-name-${channel.id}`}
              name="name"
              defaultValue={channel.name}
              required
              maxLength={64}
            />
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor={`edit-channel-code-${channel.id}`}>Code</Label>
              <Input
                id={`edit-channel-code-${channel.id}`}
                name="code"
                defaultValue={channel.code}
                required
                maxLength={16}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-channel-order-${channel.id}`}>Order</Label>
              <Input
                id={`edit-channel-order-${channel.id}`}
                name="sortOrder"
                type="number"
                defaultValue={channel.sortOrder}
                required
              />
            </div>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending} pendingLabel="Saving…">
              Save
            </SubmitButton>
          </DialogFooter>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}

function EditSourceDialog({ source }: { source: DetailChannel["sources"][number] }) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7">
          <Pencil className="size-3" />
          <span className="sr-only">Edit {source.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b">
          <DialogTitle>Edit source</DialogTitle>
          <DialogDescription>Update the human-readable label or tracked code.</DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="updateSource" />
          <input type="hidden" name="sourceId" value={source.id} />
          <div className="space-y-2">
            <Label htmlFor={`edit-source-name-${source.id}`}>Display name</Label>
            <Input
              id={`edit-source-name-${source.id}`}
              name="name"
              defaultValue={source.name}
              required
              maxLength={64}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-source-code-${source.id}`}>Code</Label>
            <Input
              id={`edit-source-code-${source.id}`}
              name="code"
              defaultValue={source.code}
              required
              maxLength={32}
              className="font-mono"
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending} pendingLabel="Saving…">
              Save
            </SubmitButton>
          </DialogFooter>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}

function SimpleCreateDialog({
  title,
  description,
  triggerLabel,
  intent,
  namePlaceholder,
  codePlaceholder,
  hidden,
}: {
  title: string;
  description: string;
  triggerLabel: string;
  intent: string;
  namePlaceholder?: string;
  codePlaceholder: string;
  hidden?: Record<string, string | number>;
}) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value={intent} />
          {Object.entries(hidden ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="space-y-2">
            <Label htmlFor={`${intent}-name`}>Display name</Label>
            <Input
              id={`${intent}-name`}
              name="name"
              required
              maxLength={64}
              placeholder={namePlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${intent}-code`}>Code</Label>
            <Input
              id={`${intent}-code`}
              name="code"
              required
              maxLength={intent === "createSource" ? 32 : 16}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              placeholder={codePlaceholder}
              className="font-mono"
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending} pendingLabel="Adding…">
              Add
            </SubmitButton>
          </DialogFooter>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}

function AssignLinksDialog({
  channels,
  links,
}: { channels: DetailChannel[]; links: AssignableLink[] }) {
  const activeChannels = channels.filter((item) => item.archivedAt === null);
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 className="size-4" />
          Assign links
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader className="border-b">
          <DialogTitle>Assign links to channels</DialogTitle>
          <DialogDescription>
            Selected links become chapter-owned and are added to this campaign.
          </DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="assign" />
          <div className="space-y-2">
            <Label htmlFor="assign-channel">Channel</Label>
            <select
              id="assign-channel"
              name="channelId"
              required
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select channel</option>
              {activeChannels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </option>
              ))}
            </select>
          </div>
          <fieldset className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Links</legend>
            {links.length === 0 ? (
              <p className="text-sm text-muted-foreground">No editable unclassified links.</p>
            ) : (
              links.map((link) => (
                <label
                  key={link.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted"
                >
                  <input type="checkbox" name="linkId" value={link.id} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {link.title || link.slug}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      /{link.slug}
                    </span>
                  </span>
                </label>
              ))
            )}
          </fieldset>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <SubmitButton
              disabled={activeChannels.length === 0 || links.length === 0}
              pending={pending}
              pendingLabel="Assigning…"
            >
              Assign selected
            </SubmitButton>
          </DialogFooter>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}

function RegisterSourceDialog({
  code,
  channelId,
  channelName,
}: {
  code: string;
  channelId: number;
  channelName: string;
}) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Register
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b">
          <DialogTitle>Register source</DialogTitle>
          <DialogDescription>
            Add a display name for the observed <code>{code}</code> source.
          </DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="registerSource" />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="channelId" value={channelId} />
          <div className="space-y-2">
            <Label>Channel</Label>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{channelName}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`register-name-${code}`}>Display name</Label>
            <Input
              id={`register-name-${code}`}
              name="name"
              defaultValue={code}
              required
              maxLength={64}
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending} pendingLabel="Registering…">
              Register
            </SubmitButton>
          </DialogFooter>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}
