import { isSuperAdmin } from "@gdgjp/gdg-lib";
import {
  Archive,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
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
import { SourceUrlBuilder } from "~/components/campaigns/source-url-builder";
import { useCampaignActionDialog } from "~/components/campaigns/use-campaign-action-dialog";
import { BarList } from "~/components/charts/bar-list";
import { HourlyChart } from "~/components/charts/hourly-chart";
import { CreateLinkDialog } from "~/components/create-link-dialog";
import { DashboardShell } from "~/components/dashboard-shell";
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
  archiveCampaignMedia,
  archiveCampaignMediaSource,
  assignLinksToMedia,
  createCampaignMedia,
  createCampaignMediaSource,
  getCampaignById,
  getCampaignWithMediaLinks,
  listAssignableLinksForCampaign,
  listTagsForChapter,
  listTagsForUser,
  updateCampaignMedia,
  updateCampaignMediaSource,
} from "~/lib/db";
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
    getCampaignWithMediaLinks(env.DB, id, true),
    listAssignableLinksForCampaign(env.DB, user.id, id),
    listTagsForUser(env.DB, user.id),
    listTagsForChapter(env.DB, campaign.ownerChapterId),
  ]);
  if (!tree) throw new Response("Not found", { status: 404 });

  const media = tree.media;
  const url = new URL(args.request.url);
  const parsed = parseAnalyticsParams(url.searchParams);
  const requestedMediaId = Number(url.searchParams.get("mediaId"));
  const selectedMediaId = media.some((item) => item.id === requestedMediaId)
    ? requestedMediaId
    : null;
  const mediaInScope = selectedMediaId
    ? media.filter((item) => item.id === selectedMediaId)
    : media;
  const requestedLinkId = url.searchParams.get("linkId");
  const selectedLinkId = mediaInScope.some((item) =>
    item.links.some((link) => link.id === requestedLinkId),
  )
    ? requestedLinkId
    : null;
  const linkIds = mediaInScope.flatMap((item) =>
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
  const sourceBreakdown = campaignSourceBreakdown(mediaInScope, sourceClicks);
  const sourceSuggestions = new Set(
    mediaInScope.flatMap((item) => item.sources.map((source) => source.code)),
  );
  for (const row of sourceClicks) if (row.source) sourceSuggestions.add(row.source);
  const suggestions: FilterSuggestions = {
    source: [...sourceSuggestions].sort(),
    slug: mediaInScope.flatMap((item) => item.links.map((link) => link.slug)),
  };

  return {
    user: { email: user.email, name: user.name },
    campaign,
    media,
    assignableLinks,
    availableTags: [...userTags, ...chapterTags],
    shortUrlBase: env.SHORT_URL_BASE,
    selectedMediaId,
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

  if (intent === "createMedia") {
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    if (!name || name.length > 64) return { error: "Media name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(code)) return { error: "Invalid media code." };
    const result = await createCampaignMedia(env.DB, { campaignId: id, name, code });
    if (!result.ok) return { error: `Media code “${code}” is already in use.` };
    return { ok: true };
  }

  if (intent === "createSource" || intent === "registerSource") {
    const mediaId = parseId(form.get("mediaId"), "media");
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    const belongs = (await getCampaignWithMediaLinks(env.DB, id))?.media.some(
      (item) => item.id === mediaId,
    );
    if (!belongs) throw new Response("Forbidden", { status: 403 });
    if (!name || name.length > 64) return { error: "Source name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) return { error: "Invalid source code." };
    const result = await createCampaignMediaSource(env.DB, { mediaId, name, code });
    if (!result.ok) return { error: `Source code “${code}” is already registered.` };
    return { ok: true };
  }

  if (intent === "updateMedia") {
    const mediaId = parseId(form.get("mediaId"), "media");
    const tree = await getCampaignWithMediaLinks(env.DB, id, true);
    if (!tree?.media.some((item) => item.id === mediaId)) {
      throw new Response("Forbidden", { status: 403 });
    }
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    const sortOrder = Number(form.get("sortOrder"));
    if (!name || name.length > 64) return { error: "Media name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(code)) return { error: "Invalid media code." };
    if (!Number.isInteger(sortOrder)) return { error: "Sort order must be an integer." };
    const result = await updateCampaignMedia(env.DB, mediaId, { name, code, sortOrder });
    if (result && !result.ok) return { error: `Media code “${code}” is already in use.` };
    return { ok: true };
  }

  if (intent === "updateSource") {
    const sourceId = parseId(form.get("sourceId"), "source");
    const tree = await getCampaignWithMediaLinks(env.DB, id, true);
    if (!tree?.media.some((item) => item.sources.some((source) => source.id === sourceId))) {
      throw new Response("Forbidden", { status: 403 });
    }
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    if (!name || name.length > 64) return { error: "Source name must be 1–64 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) return { error: "Invalid source code." };
    const result = await updateCampaignMediaSource(env.DB, sourceId, { name, code });
    if (result && !result.ok) return { error: `Source code “${code}” is already registered.` };
    return { ok: true };
  }

  if (intent === "assign") {
    const mediaId = parseId(form.get("mediaId"), "media");
    const linkIds = form.getAll("linkId").map(String);
    const creativeName = String(form.get("creativeName") ?? "").trim() || undefined;
    if (linkIds.length === 0) return { error: "Select at least one link." };
    if (creativeName && creativeName.length > 80) return { error: "Creative name is too long." };
    const tree = await getCampaignWithMediaLinks(env.DB, id);
    if (!tree?.media.some((item) => item.id === mediaId)) {
      throw new Response("Forbidden", { status: 403 });
    }
    const result = await assignLinksToMedia(env.DB, {
      linkIds,
      mediaId,
      actorUserId: user.id,
      creativeName,
    });
    if (result.assignedIds.length === 0)
      return { error: "The selected links could not be assigned." };
    if (result.rejectedIds.length > 0) {
      return { error: `${result.rejectedIds.length} link(s) could not be assigned.` };
    }
    return { ok: true };
  }

  if (intent === "archiveMedia" || intent === "restoreMedia") {
    const mediaId = parseId(form.get("mediaId"), "media");
    const belongs = (await getCampaignWithMediaLinks(env.DB, id, true))?.media.some(
      (item) => item.id === mediaId,
    );
    if (!belongs) throw new Response("Forbidden", { status: 403 });
    await archiveCampaignMedia(env.DB, mediaId, intent === "archiveMedia");
    return { ok: true };
  }

  if (intent === "archiveSource" || intent === "restoreSource") {
    const sourceId = parseId(form.get("sourceId"), "source");
    const belongs = (await getCampaignWithMediaLinks(env.DB, id, true))?.media.some((item) =>
      item.sources.some((source) => source.id === sourceId),
    );
    if (!belongs) throw new Response("Forbidden", { status: 403 });
    await archiveCampaignMediaSource(env.DB, sourceId, intent === "archiveSource");
    return { ok: true };
  }

  return { error: `Unknown action for ${campaign.name}.` };
}

export default function CampaignDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    campaign,
    media,
    assignableLinks,
    availableTags,
    shortUrlBase,
    selectedMediaId,
    selectedLinkId,
    preset,
    customStart,
    customEnd,
    filters,
    suggestions,
    analytics,
  } = loaderData;
  const activeMedia = media.filter((item) => item.archivedAt === null);
  const mediaInScope = selectedMediaId
    ? media.filter((item) => item.id === selectedMediaId)
    : media;
  const linkRows = mediaInScope
    .flatMap((item) => item.links)
    .filter((link) => !selectedLinkId || link.id === selectedLinkId)
    .map((link) => ({
      name: link.creativeName || link.title || link.slug,
      clicks: analytics.clicks[link.id] ?? 0,
    }))
    .sort((a, b) => b.clicks - a.clicks);
  const mediaRows = mediaInScope
    .map((item) => ({
      name: item.name,
      clicks: item.links.reduce((sum, link) => sum + (analytics.clicks[link.id] ?? 0), 0),
    }))
    .sort((a, b) => b.clicks - a.clicks);

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
                Media, creative, and source performance
              </p>
            </div>
            <div className="flex gap-2">
              <AssignLinksDialog media={activeMedia} links={assignableLinks} />
              <CreateLinkDialog
                availableTags={availableTags}
                defaultCampaignMediaId={activeMedia[0]?.id}
                campaignMediaOptions={activeMedia.map((item) => ({
                  id: item.id,
                  campaignName: campaign.name,
                  campaignCode: campaign.code,
                  mediaName: item.name,
                  mediaCode: item.code,
                }))}
                shortUrlBase={shortUrlBase}
                trigger={
                  <Button size="sm" disabled={activeMedia.length === 0}>
                    <Link2 className="size-4" />
                    Create link
                  </Button>
                }
              />
              <CreateMediaDialog campaignCode={campaign.code} />
            </div>
          </div>
        </div>

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
              suggestions={suggestions}
            />
          </div>
          <CampaignScopeFilters
            media={media}
            selectedMediaId={selectedMediaId}
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
                <CardTitle className="text-sm">Media</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList rows={mediaRows} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Links / creatives</CardTitle>
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
                  key={`${source.mediaId}:${source.code}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
                >
                  <div>
                    <code className="text-sm">
                      {source.mediaName} / {source.code}
                    </code>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {source.clicks} clicks
                    </span>
                  </div>
                  {media.find((item) => item.id === source.mediaId)?.archivedAt === null ? (
                    <RegisterSourceDialog
                      code={source.code}
                      mediaId={source.mediaId}
                      mediaName={source.mediaName}
                    />
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <section aria-labelledby="media-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="media-heading" className="text-lg font-semibold">
              Campaign map
            </h2>
            <span className="text-sm text-muted-foreground">{media.length} media</span>
          </div>
          {media.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Add a medium such as X, Discord, or Instagram.
            </div>
          ) : (
            media.map((item) => (
              <MediumCard
                key={item.id}
                medium={item}
                shortUrlBase={shortUrlBase}
                clicks={analytics.clicks}
              />
            ))
          )}
        </section>
      </div>
    </DashboardShell>
  );
}

type DetailMedium = Route.ComponentProps["loaderData"]["media"][number];
type AssignableLink = Route.ComponentProps["loaderData"]["assignableLinks"][number];

function CampaignScopeFilters({
  media,
  selectedMediaId,
  selectedLinkId,
}: {
  media: DetailMedium[];
  selectedMediaId: number | null;
  selectedLinkId: string | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const links = (
    selectedMediaId ? media.filter((item) => item.id === selectedMediaId) : media
  ).flatMap((item) => item.links.map((link) => ({ ...link, mediaName: item.name })));

  function setScope(name: "mediaId" | "linkId", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "mediaId") next.delete("linkId");
    setSearchParams(next, { preventScrollReset: true });
  }

  function clearScope() {
    const next = new URLSearchParams(searchParams);
    next.delete("mediaId");
    next.delete("linkId");
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="min-w-48 space-y-1">
        <Label htmlFor="analytics-media">Media</Label>
        <select
          id="analytics-media"
          value={selectedMediaId ?? ""}
          onChange={(event) => setScope("mediaId", event.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All media</option>
          {media.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.archivedAt !== null ? " (Archived)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-56 flex-1 space-y-1">
        <Label htmlFor="analytics-link">Link / creative</Label>
        <select
          id="analytics-link"
          value={selectedLinkId ?? ""}
          onChange={(event) => setScope("linkId", event.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All links</option>
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.mediaName} / {link.creativeName || link.title || link.slug}
            </option>
          ))}
        </select>
      </div>
      {selectedMediaId || selectedLinkId ? (
        <Button type="button" variant="ghost" size="sm" onClick={clearScope}>
          <X className="size-4" /> Clear scope
        </Button>
      ) : null}
    </div>
  );
}

function MediumCard({
  medium,
  shortUrlBase,
  clicks,
}: { medium: DetailMedium; shortUrlBase: string; clicks: Record<string, number> }) {
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
            <span className="font-medium">{medium.name}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{medium.code}</span>
            {medium.archivedAt !== null ? (
              <Badge variant="secondary" className="ml-2">
                Archived
              </Badge>
            ) : null}
            <span className="block text-xs text-muted-foreground">
              {medium.links.length} links · {medium.sources.length} sources
            </span>
          </span>
          <ChevronDown
            className={`ml-auto size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {medium.archivedAt === null ? <CreateSourceDialog mediaId={medium.id} /> : null}
        <EditMediaDialog medium={medium} />
        <Form method="post">
          <input
            type="hidden"
            name="intent"
            value={medium.archivedAt === null ? "archiveMedia" : "restoreMedia"}
          />
          <input type="hidden" name="mediaId" value={medium.id} />
          <Button type="submit" size="icon" variant="ghost">
            {medium.archivedAt === null ? (
              <Archive className="size-4" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            <span className="sr-only">
              {medium.archivedAt === null ? "Archive" : "Restore"} {medium.name}
            </span>
          </Button>
        </Form>
      </div>
      {open ? (
        <div className="border-t px-5 py-4">
          {medium.sources.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {medium.sources.map((source) => (
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
          {medium.links.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">No links assigned yet.</p>
          ) : (
            <div className="space-y-3">
              {medium.links.map((link) => (
                <div key={link.id} className="rounded-lg border p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/links/${link.id}`} className="font-medium hover:underline">
                        {link.creativeName || link.title || link.slug}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {shortUrlBase}/{link.slug}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {(clicks[link.id] ?? 0).toLocaleString()} clicks
                      </span>
                      <a href={`${shortUrlBase}/${link.slug}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                        <span className="sr-only">Open link</span>
                      </a>
                    </div>
                  </div>
                  <SourceUrlBuilder
                    shortUrl={`${shortUrlBase}/${link.slug}`}
                    sources={medium.sources.filter((source) => source.archivedAt === null)}
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

function CreateMediaDialog({ campaignCode }: { campaignCode: string }) {
  return (
    <SimpleCreateDialog
      title="Add media"
      description={`Create a channel under ${campaignCode}.`}
      triggerLabel="Add media"
      intent="createMedia"
      codePlaceholder="x"
    />
  );
}

function CreateSourceDialog({ mediaId }: { mediaId: number }) {
  return (
    <SimpleCreateDialog
      title="Add source"
      description="Register a recurring distribution target."
      triggerLabel="Source"
      intent="createSource"
      codePlaceholder="tokyo"
      hidden={{ mediaId }}
    />
  );
}

function EditMediaDialog({ medium }: { medium: DetailMedium }) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost">
          <Pencil className="size-4" />
          <span className="sr-only">Edit {medium.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b">
          <DialogTitle>Edit media</DialogTitle>
          <DialogDescription>Change its label, code, or campaign ordering.</DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="updateMedia" />
          <input type="hidden" name="mediaId" value={medium.id} />
          <div className="space-y-2">
            <Label htmlFor={`edit-media-name-${medium.id}`}>Display name</Label>
            <Input
              id={`edit-media-name-${medium.id}`}
              name="name"
              defaultValue={medium.name}
              required
              maxLength={64}
            />
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor={`edit-media-code-${medium.id}`}>Code</Label>
              <Input
                id={`edit-media-code-${medium.id}`}
                name="code"
                defaultValue={medium.code}
                required
                maxLength={16}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-media-order-${medium.id}`}>Order</Label>
              <Input
                id={`edit-media-order-${medium.id}`}
                name="sortOrder"
                type="number"
                defaultValue={medium.sortOrder}
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

function EditSourceDialog({ source }: { source: DetailMedium["sources"][number] }) {
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

function AssignLinksDialog({ media, links }: { media: DetailMedium[]; links: AssignableLink[] }) {
  const activeMedia = media.filter((item) => item.archivedAt === null);
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
          <DialogTitle>Assign links to media</DialogTitle>
          <DialogDescription>
            Selected links become chapter-owned and share one optional creative label.
          </DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="assign" />
          <div className="space-y-2">
            <Label htmlFor="assign-media">Media</Label>
            <select
              id="assign-media"
              name="mediaId"
              required
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select media</option>
              {activeMedia.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="creative-name">Creative name (optional)</Label>
            <Input
              id="creative-name"
              name="creativeName"
              maxLength={80}
              placeholder="Alice session announcement"
            />
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
              disabled={activeMedia.length === 0 || links.length === 0}
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
  mediaId,
  mediaName,
}: {
  code: string;
  mediaId: number;
  mediaName: string;
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
          <input type="hidden" name="mediaId" value={mediaId} />
          <div className="space-y-2">
            <Label>Media</Label>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{mediaName}</p>
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
