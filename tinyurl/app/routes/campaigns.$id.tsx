import { isSuperAdmin } from "@gdgjp/gdg-lib";
import {
  Archive,
  BarChart3,
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
import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { FilterSuggestions } from "~/components/analytics/analytics-filter-button";
import { AnalyticsFiltersBar } from "~/components/analytics/analytics-filters-bar";
import { useCampaignActionDialog } from "~/components/campaigns/use-campaign-action-dialog";
import { BarList } from "~/components/charts/bar-list";
import { HourlyChart } from "~/components/charts/hourly-chart";
import { CreateLinkDialog } from "~/components/create-link-dialog";
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
import { SubmitButton } from "~/components/ui/submit-button";
import {
  clicksByLinkId,
  clicksByLinkIdAndSource,
  granularityFor,
  hourlyClicks,
  totalClicks,
} from "~/lib/analytics-engine";
import { parseAnalyticsParams } from "~/lib/analytics-filters";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { campaignSourceBreakdown } from "~/lib/campaign-analytics";
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

function parseId(value: FormDataEntryValue | null, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Response(`Invalid ${label}.`, { status: 400 });
  return id;
}

async function requireCampaignAccess(args: Route.LoaderArgs | Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);
  const id = Number(args.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new Response("Not found", { status: 404 });
  const campaign = await getCampaignById(env.DB, id);
  if (!campaign) throw new Response("Not found", { status: 404 });
  if (campaign.ownerChapterId !== chapter.chapterId && !isSuperAdmin(user)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { env, user, chapter, campaign, id };
}

export async function loader(args: Route.LoaderArgs) {
  const { env, user, campaign, id } = await requireCampaignAccess(args);
  const [tree, assignableLinks, userTags, chapterTags] = await Promise.all([
    getCampaignWithChannelLinks(env.DB, id, true),
    listAssignableLinksForCampaign(env.DB, user.id, id),
    listTagsForUser(env.DB, user.id),
    listTagsForChapter(env.DB, campaign.ownerChapterId),
  ]);
  if (!tree) throw new Response("Not found", { status: 404 });

  const channels = tree.channels;
  const ownerIds = [
    ...new Set(channels.flatMap((item) => item.links.map((link) => link.ownerUserId))),
  ];
  const owners =
    ownerIds.length > 0
      ? await getUsersByIds(env.DB, ownerIds).catch(() => ({}) as Record<string, UserSummary>)
      : {};
  const url = new URL(args.request.url);
  const parsed = parseAnalyticsParams(url.searchParams);
  const requestedChannelId = Number(url.searchParams.get("channelId"));
  const selectedChannelId = channels.some((item) => item.id === requestedChannelId)
    ? requestedChannelId
    : null;
  const channelsInScope = selectedChannelId
    ? channels.filter((item) => item.id === selectedChannelId)
    : channels;
  const requestedLinkId = url.searchParams.get("linkId");
  const selectedLinkId = channelsInScope.some((item) =>
    item.links.some((link) => link.id === requestedLinkId),
  )
    ? requestedLinkId
    : null;
  const linkIds = channelsInScope.flatMap((item) =>
    item.links
      .filter((link) => !selectedLinkId || link.id === selectedLinkId)
      .map((link) => link.id),
  );
  const opts = { window: parsed.window, filters: parsed.filters };
  const fallback =
    <T,>(label: string, value: T) =>
    (error: unknown): T => {
      console.error(`Campaign analytics query failed (${label}):`, error);
      return value;
    };
  const [total, hourly, clickMap, sourceClicks] =
    linkIds.length === 0
      ? [0, [], new Map<string, number>(), []]
      : await Promise.all([
          totalClicks(env, linkIds, opts).catch(fallback("total", 0)),
          hourlyClicks(env, linkIds, opts).catch(fallback("hourly", [])),
          clicksByLinkId(env, linkIds, opts).catch(fallback("links", new Map<string, number>())),
          clicksByLinkIdAndSource(env, linkIds, opts).catch(fallback("sources", [])),
        ]);
  const clicks: Record<string, number> = {};
  for (const [linkId, count] of clickMap) clicks[linkId] = count;
  const sourceBreakdown = campaignSourceBreakdown(channelsInScope, sourceClicks);
  const sourceSuggestions = new Set(
    channelsInScope.flatMap((item) => item.sources.map((source) => source.code)),
  );
  for (const row of sourceClicks) if (row.source) sourceSuggestions.add(row.source);
  const suggestions: FilterSuggestions = {
    source: [...sourceSuggestions].sort(),
    slug: channelsInScope.flatMap((item) => item.links.map((link) => link.slug)),
  };

  return {
    user: { email: user.email, name: user.name },
    campaign,
    channels,
    owners,
    assignableLinks,
    availableTags: [...userTags, ...chapterTags],
    shortUrlBase: env.SHORT_URL_BASE,
    selectedChannelId,
    selectedLinkId,
    preset: parsed.preset,
    customStart: parsed.window.kind === "custom" ? parsed.window.startIso : undefined,
    customEnd: parsed.window.kind === "custom" ? parsed.window.endIso : undefined,
    filters: parsed.filters,
    suggestions,
    analytics: {
      total,
      hourly,
      clicks,
      topSources: sourceBreakdown.rows,
      unregisteredSources: sourceBreakdown.unregistered,
      granularity: granularityFor(parsed.window),
    },
  };
}

export async function action(args: Route.ActionArgs) {
  const { env, user, campaign, id } = await requireCampaignAccess(args);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

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
    owners,
    assignableLinks,
    availableTags,
    shortUrlBase,
    selectedChannelId,
    selectedLinkId,
    preset,
    customStart,
    customEnd,
    filters,
    suggestions,
    analytics,
  } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get("view") === "analytics" ? "analytics" : "channels";
  const activeChannels = channels.filter((item) => item.archivedAt === null);
  const channelsInScope = selectedChannelId
    ? channels.filter((item) => item.id === selectedChannelId)
    : channels;
  const linkRows = channelsInScope
    .flatMap((item) => item.links)
    .filter((link) => !selectedLinkId || link.id === selectedLinkId)
    .map((link) => ({
      name: link.description || link.title || link.slug,
      clicks: analytics.clicks[link.id] ?? 0,
    }))
    .sort((a, b) => b.clicks - a.clicks);
  const channelRows = channelsInScope
    .map((item) => ({
      name: item.name,
      clicks: item.links.reduce((sum, link) => sum + (analytics.clicks[link.id] ?? 0), 0),
    }))
    .sort((a, b) => b.clicks - a.clicks);

  function setView(view: "channels" | "analytics") {
    const next = new URLSearchParams(searchParams);
    if (view === "analytics") next.set("view", "analytics");
    else next.delete("view");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <DashboardShell user={user}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {actionData && "error" in actionData ? (
          <Alert variant="destructive">
            <AlertDescription>{actionData.error}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <Link
            to="/campaigns"
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" /> Campaigns
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
                <Badge variant="outline" className="font-mono">
                  {campaign.code}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Channel, links, and source performance
              </p>
            </div>
            <div className="flex gap-2">
              <AssignLinksDialog channels={activeChannels} links={assignableLinks} />
              <CreateChannelDialog campaignCode={campaign.code} />
            </div>
          </div>
        </div>

        <div
          className="relative grid w-fit grid-cols-2 rounded-lg bg-muted p-1"
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
              channels.map((item) => (
                <ChannelCard
                  key={item.id}
                  campaign={campaign}
                  channel={item}
                  owners={owners}
                  availableTags={availableTags}
                  shortUrlBase={shortUrlBase}
                  clicks={analytics.clicks}
                />
              ))
            )}
          </section>
        ) : (
          <div
            id="analytics-panel"
            role="tabpanel"
            aria-labelledby="analytics-tab"
            className="space-y-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-1 motion-safe:duration-200"
          >
            <section aria-labelledby="analytics-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="analytics-heading"
                  className="flex items-center gap-2 text-lg font-semibold"
                >
                  <BarChart3 className="size-5" /> Analytics
                </h2>
                <AnalyticsFiltersBar
                  preset={preset}
                  startIso={customStart}
                  endIso={customEnd}
                  filters={filters}
                  suggestions={suggestions}
                />
              </div>
              <CampaignScopeFilters
                channels={channels}
                selectedChannelId={selectedChannelId}
                selectedLinkId={selectedLinkId}
              />
              <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
                <Card>
                  <CardHeader className="border-b">
                    <CardTitle className="flex items-end justify-between gap-4">
                      <span className="text-sm font-medium text-muted-foreground">Clicks</span>
                      <span className="text-3xl font-semibold tabular-nums">
                        {analytics.total.toLocaleString()}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HourlyChart
                      data={analytics.hourly}
                      height={260}
                      granularity={analytics.granularity}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Sources</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarList
                      rows={analytics.topSources}
                      emptyLabel="No source data yet."
                      height={260}
                    />
                  </CardContent>
                </Card>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Channel</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarList rows={channelRows} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Links</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarList rows={linkRows} />
                  </CardContent>
                </Card>
              </div>
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
                        <span className="ml-2 text-xs text-muted-foreground">
                          {source.clicks} clicks
                        </span>
                      </div>
                      {channels.find((item) => item.id === source.channelId)?.archivedAt ===
                      null ? (
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
        )}
      </div>
    </DashboardShell>
  );
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
}: {
  channels: DetailChannel[];
  selectedChannelId: number | null;
  selectedLinkId: string | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
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
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="min-w-48 space-y-1">
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
      <div className="min-w-56 flex-1 space-y-1">
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
              {link.channelName} / {link.description || link.title || link.slug}
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
  shortUrlBase,
  clicks,
}: {
  campaign: DetailCampaign;
  channel: DetailChannel;
  owners: Record<string, UserSummary>;
  availableTags: AvailableTag[];
  shortUrlBase: string;
  clicks: Record<string, number>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 px-5 py-4">
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
      {open ? (
        <div className="border-t px-5 py-4">
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

function CreateSourceDialog({ channelId }: { channelId: number }) {
  return (
    <SimpleCreateDialog
      title="Add source"
      description="Register a recurring distribution target."
      triggerLabel="Source"
      intent="createSource"
      codePlaceholder="tokyo"
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
  codePlaceholder,
  hidden,
}: {
  title: string;
  description: string;
  triggerLabel: string;
  intent: string;
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
            <Input id={`${intent}-name`} name="name" required maxLength={64} />
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
