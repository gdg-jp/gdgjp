import { FolderTree, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Await } from "react-router";
import { CreateLinkDialog } from "~/components/create-link-dialog";
import {
  DEFAULT_DISPLAY_PROPERTIES,
  DashboardDisplayMenu,
  type DisplayLayout,
  type DisplayProperty,
} from "~/components/dashboard-display-menu";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import { LinkCard, type LinkCardItem, type LinkOwner } from "~/components/link-card";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { clicksByLinkId } from "~/lib/analytics-engine";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  type Link as DbLink,
  type Tag as DbTag,
  type UserSummary,
  getUsersByIds,
  listCampaignChannels,
  listCampaignsForChaptersWithCounts,
  listLinksAccessibleByEmail,
  listLinksForChapter,
  listLinksForUser,
  listPublicLinks,
  listTagsForChapter,
  listTagsForLinks,
  listTagsForUser,
} from "~/lib/db";
import { listDomainsForChapters } from "~/lib/domains";
import type { Route } from "./+types/dashboard";

export function meta() {
  return [{ title: "Links — GDG Japan Links" }];
}

export async function loader(args: Route.LoaderArgs) {
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
  };
}

function shellUser(loaderData: Route.ComponentProps["loaderData"]) {
  return {
    email: loaderData.user.email,
    image: loaderData.user.image,
    name: loaderData.user.name,
  };
}

type Scope = "all" | "own" | "shared";
type SortKey = "newest" | "oldest" | "mostClicks";
type CampaignFilter = "all" | "unclassified" | `campaign:${number}` | `channel:${number}`;

const DISPLAY_PREFERENCES_KEY = "gdgjp-tinyurl-display-v1";
const DISPLAY_PROPERTIES = new Set<DisplayProperty>([
  "shortLink",
  "destinationUrl",
  "title",
  "description",
  "createdDate",
  "creator",
  "tags",
  "analytics",
]);

type DisplayPreferences = {
  layout: DisplayLayout;
  sort: SortKey;
  showArchived: boolean;
  properties: DisplayProperty[];
};

const BUILT_IN_DISPLAY_DEFAULTS: DisplayPreferences = {
  layout: "cards",
  sort: "newest",
  showArchived: false,
  properties: DEFAULT_DISPLAY_PROPERTIES,
};

function displayPreferencesEqual(left: DisplayPreferences, right: DisplayPreferences): boolean {
  if (
    left.layout !== right.layout ||
    left.sort !== right.sort ||
    left.showArchived !== right.showArchived ||
    left.properties.length !== right.properties.length
  ) {
    return false;
  }
  const rightProperties = new Set(right.properties);
  return left.properties.every((property) => rightProperties.has(property));
}

function ownerOf(owners: Record<string, UserSummary>, id: string): LinkOwner | undefined {
  const u = owners[id];
  if (!u) return { id, email: "", name: "", image: null };
  return { id: u.id, email: u.email, name: u.name, image: u.image };
}

function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    ownLinks,
    sharedLinks,
    owners,
    tagsByLinkId,
    availableTags,
    campaignChannelCatalog,
    campaignChannelOptions,
    chapters,
    shortUrlBase,
    domainOptions,
  } = loaderData;
  const user = shellUser(loaderData);
  const shortHost = shortHostOf(shortUrlBase);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [layout, setLayout] = useState<DisplayLayout>("cards");
  const [showArchived, setShowArchived] = useState(false);
  const [displayProperties, setDisplayProperties] = useState<DisplayProperty[]>(
    DEFAULT_DISPLAY_PROPERTIES,
  );
  const [defaultPreferences, setDefaultPreferences] =
    useState<DisplayPreferences>(BUILT_IN_DISPLAY_DEFAULTS);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DISPLAY_PREFERENCES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as {
          layout?: unknown;
          sort?: unknown;
          showArchived?: unknown;
          properties?: unknown;
        };
        const nextDefaults: DisplayPreferences = {
          layout: parsed.layout === "cards" || parsed.layout === "rows" ? parsed.layout : "cards",
          sort:
            parsed.sort === "newest" || parsed.sort === "oldest" || parsed.sort === "mostClicks"
              ? parsed.sort
              : "newest",
          showArchived: typeof parsed.showArchived === "boolean" ? parsed.showArchived : false,
          properties: Array.isArray(parsed.properties)
            ? parsed.properties.filter(
                (property): property is DisplayProperty =>
                  typeof property === "string" &&
                  DISPLAY_PROPERTIES.has(property as DisplayProperty),
              )
            : DEFAULT_DISPLAY_PROPERTIES,
        };
        setLayout(nextDefaults.layout);
        setSort(nextDefaults.sort);
        setShowArchived(nextDefaults.showArchived);
        setDisplayProperties(nextDefaults.properties);
        setDefaultPreferences(nextDefaults);
      }
    } catch {
      // Invalid or unavailable storage should not prevent the dashboard from rendering.
    } finally {
      setPreferencesLoaded(true);
    }
  }, []);

  const currentPreferences: DisplayPreferences = {
    layout,
    sort,
    showArchived,
    properties: displayProperties,
  };
  const displayPreferencesChanged =
    preferencesLoaded && !displayPreferencesEqual(currentPreferences, defaultPreferences);

  function applyDisplayPreferences(nextPreferences: DisplayPreferences) {
    const apply = () => {
      setLayout(nextPreferences.layout);
      setSort(nextPreferences.sort);
      setShowArchived(nextPreferences.showArchived);
      setDisplayProperties([...nextPreferences.properties]);
    };
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    };
    if (nextPreferences.layout === layout || !transitionDocument.startViewTransition) {
      apply();
      return;
    }
    transitionDocument.startViewTransition(() => {
      flushSync(apply);
    });
  }

  function changeLayout(nextLayout: DisplayLayout) {
    if (nextLayout === layout) return;
    applyDisplayPreferences({ ...currentPreferences, layout: nextLayout });
  }

  function resetDisplayPreferences() {
    applyDisplayPreferences(defaultPreferences);
  }

  function setCurrentAsDefault() {
    const nextDefaults = {
      ...currentPreferences,
      properties: [...currentPreferences.properties],
    };
    setDefaultPreferences(nextDefaults);
    try {
      window.localStorage.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify(nextDefaults));
    } catch {
      // The default remains active for this session when browser storage is unavailable.
    }
  }

  const channelById = useMemo(
    () => new Map(campaignChannelCatalog.map((option) => [option.id, option])),
    [campaignChannelCatalog],
  );

  const campaignFilterLabel = useMemo(() => {
    if (campaignFilter === "all") return "All campaigns";
    if (campaignFilter === "unclassified") return "Unclassified";
    if (campaignFilter.startsWith("campaign:")) {
      const campaignId = Number(campaignFilter.slice("campaign:".length));
      return (
        campaignChannelCatalog.find((option) => option.campaignId === campaignId)?.campaignName ??
        "Campaign"
      );
    }
    const channelId = Number(campaignFilter.slice("channel:".length));
    const option = channelById.get(channelId);
    return option ? `${option.campaignName} / ${option.channelName}` : "Channel";
  }, [campaignFilter, campaignChannelCatalog, channelById]);

  const campaignGroups = useMemo(() => {
    const groups = new Map<
      number,
      { id: number; name: string; channels: typeof campaignChannelCatalog }
    >();
    for (const option of campaignChannelCatalog) {
      const group = groups.get(option.campaignId) ?? {
        id: option.campaignId,
        name: option.campaignName,
        channels: [],
      };
      group.channels.push(option);
      groups.set(option.campaignId, group);
    }
    return [...groups.values()];
  }, [campaignChannelCatalog]);

  const totalCount = ownLinks.length + sharedLinks.length;

  return (
    <DashboardShell user={user}>
      <DashboardPage>
        <DashboardPageHeader
          title="Links"
          actions={
            <CreateLinkDialog
              availableTags={availableTags}
              campaignChannelOptions={campaignChannelOptions}
              chapters={chapters}
              shortUrlBase={shortUrlBase}
              domainOptions={domainOptions}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" />
                  Create link
                  <kbd className="ml-1 rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wider">
                    C
                  </kbd>
                </Button>
              }
            />
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <SlidersHorizontal className="size-4" />
                  Filter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuLabel>Scope</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={scope === "all"}
                  onCheckedChange={() => setScope("all")}
                >
                  All links
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={scope === "own"}
                  onCheckedChange={() => setScope("own")}
                >
                  Owned by me
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={scope === "shared"}
                  onCheckedChange={() => setScope("shared")}
                >
                  Shared with me
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-56">
                  <FolderTree className="size-4" />
                  <span className="truncate">{campaignFilterLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
                <DropdownMenuLabel>Campaign</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={campaignFilter === "all"}
                  onCheckedChange={() => setCampaignFilter("all")}
                >
                  All campaigns
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={campaignFilter === "unclassified"}
                  onCheckedChange={() => setCampaignFilter("unclassified")}
                >
                  Unclassified
                </DropdownMenuCheckboxItem>
                {campaignGroups.map((campaign) => (
                  <div key={campaign.id}>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={campaignFilter === `campaign:${campaign.id}`}
                      onCheckedChange={() => setCampaignFilter(`campaign:${campaign.id}`)}
                    >
                      {campaign.name}
                    </DropdownMenuCheckboxItem>
                    {campaign.channels.map((channel) => (
                      <DropdownMenuCheckboxItem
                        key={channel.id}
                        checked={campaignFilter === `channel:${channel.id}`}
                        onCheckedChange={() => setCampaignFilter(`channel:${channel.id}`)}
                        className="pl-8"
                      >
                        {channel.channelName}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DashboardDisplayMenu
              layout={layout}
              onLayoutChange={changeLayout}
              sort={sort}
              onSortChange={setSort}
              showArchived={showArchived}
              onShowArchivedChange={setShowArchived}
              properties={displayProperties}
              onPropertiesChange={setDisplayProperties}
              showDefaultActions={displayPreferencesChanged}
              onResetToDefault={resetDisplayPreferences}
              onSetAsDefault={setCurrentAsDefault}
            />
          </div>

          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by short link or URL"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        {totalCount === 0 ? (
          <EmptyState
            availableTags={availableTags}
            campaignChannelOptions={campaignChannelOptions}
            chapters={chapters}
            shortUrlBase={shortUrlBase}
            domainOptions={domainOptions}
          />
        ) : (
          <Suspense fallback={<LinksSkeleton />}>
            <Await resolve={loaderData.clicks}>
              {(clicks) => (
                <DashboardResults
                  ownLinks={ownLinks}
                  sharedLinks={sharedLinks}
                  owners={owners}
                  tagsByLinkId={tagsByLinkId}
                  clicks={clicks}
                  scope={scope}
                  query={query}
                  sort={sort}
                  campaignFilter={campaignFilter}
                  layout={layout}
                  showArchived={showArchived}
                  displayProperties={displayProperties}
                  channelById={channelById}
                  shortUrlBase={shortUrlBase}
                  shortHost={shortHost}
                />
              )}
            </Await>
          </Suspense>
        )}
      </DashboardPage>
    </DashboardShell>
  );
}

function LinksSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading link statistics">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

function DashboardResults({
  ownLinks,
  sharedLinks,
  owners,
  tagsByLinkId,
  clicks,
  scope,
  query,
  sort,
  campaignFilter,
  layout,
  showArchived,
  displayProperties,
  channelById,
  shortUrlBase,
  shortHost,
}: {
  ownLinks: DbLink[];
  sharedLinks: DbLink[];
  owners: Record<string, UserSummary>;
  tagsByLinkId: Route.ComponentProps["loaderData"]["tagsByLinkId"];
  clicks: Record<string, number>;
  scope: Scope;
  query: string;
  sort: SortKey;
  campaignFilter: CampaignFilter;
  layout: DisplayLayout;
  showArchived: boolean;
  displayProperties: DisplayProperty[];
  channelById: Map<number, Route.ComponentProps["loaderData"]["campaignChannelCatalog"][number]>;
  shortUrlBase: string;
  shortHost: string;
}) {
  const items = useMemo<LinkCardItem[]>(() => {
    const toItem = (link: DbLink): LinkCardItem => ({
      link,
      owner: ownerOf(owners, link.ownerUserId),
      clicks: clicks[link.id] ?? 0,
      tags: tagsByLinkId[link.id] ?? [],
      campaign: link.campaignChannelId ? channelById.get(link.campaignChannelId) : undefined,
    });
    const own = ownLinks.map(toItem);
    const shared = sharedLinks.map(toItem);
    let combined = scope === "own" ? own : scope === "shared" ? shared : [...own, ...shared];

    if (!showArchived) combined = combined.filter((item) => item.link.archivedAt === null);

    if (campaignFilter === "unclassified") {
      combined = combined.filter((item) => item.link.campaignChannelId === null);
    } else if (campaignFilter.startsWith("campaign:")) {
      const campaignId = Number(campaignFilter.slice("campaign:".length));
      combined = combined.filter((item) => item.campaign?.campaignId === campaignId);
    } else if (campaignFilter.startsWith("channel:")) {
      const channelId = Number(campaignFilter.slice("channel:".length));
      combined = combined.filter((item) => item.link.campaignChannelId === channelId);
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      combined = combined.filter(
        (item) =>
          item.link.slug.toLowerCase().includes(normalizedQuery) ||
          item.link.destinationUrl.toLowerCase().includes(normalizedQuery) ||
          (item.link.title?.toLowerCase().includes(normalizedQuery) ?? false) ||
          (item.link.description?.toLowerCase().includes(normalizedQuery) ?? false) ||
          (item.campaign?.campaignName.toLowerCase().includes(normalizedQuery) ?? false) ||
          (item.campaign?.channelName.toLowerCase().includes(normalizedQuery) ?? false),
      );
    }

    const sorted = [...combined];
    if (sort === "newest") sorted.sort((a, b) => b.link.createdAt - a.link.createdAt);
    else if (sort === "oldest") sorted.sort((a, b) => a.link.createdAt - b.link.createdAt);
    else sorted.sort((a, b) => b.clicks - a.clicks);
    return sorted;
  }, [
    ownLinks,
    sharedLinks,
    owners,
    tagsByLinkId,
    clicks,
    scope,
    query,
    sort,
    campaignFilter,
    channelById,
    showArchived,
  ]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
        No links match your filters.
      </div>
    );
  }

  const accessibleCount = showArchived
    ? ownLinks.length + sharedLinks.length
    : [...ownLinks, ...sharedLinks].filter((link) => link.archivedAt === null).length;

  return (
    <>
      <div
        className={
          layout === "cards"
            ? "flex flex-col gap-2"
            : "divide-y overflow-x-auto rounded-xl border bg-card"
        }
      >
        {items.map((item) => (
          <LinkCard
            key={item.link.id}
            item={item}
            shortUrlBase={shortUrlBase}
            shortHost={shortHost}
            layout={layout}
            properties={displayProperties}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Viewing 1–{items.length} of {accessibleCount} links
      </p>
    </>
  );
}

function EmptyState({
  availableTags,
  campaignChannelOptions,
  chapters,
  shortUrlBase,
  domainOptions,
}: {
  availableTags: DbTag[];
  campaignChannelOptions: Route.ComponentProps["loaderData"]["campaignChannelOptions"];
  chapters: Route.ComponentProps["loaderData"]["chapters"];
  shortUrlBase: string;
  domainOptions: Route.ComponentProps["loaderData"]["domainOptions"];
}) {
  return (
    <div className="rounded-xl border bg-card p-10 text-center">
      <h2 className="text-lg font-medium">No links yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create your first short link to get started.
      </p>
      <div className="mt-4 inline-block">
        <CreateLinkDialog
          availableTags={availableTags}
          campaignChannelOptions={campaignChannelOptions}
          chapters={chapters}
          shortUrlBase={shortUrlBase}
          domainOptions={domainOptions}
          trigger={
            <Button size="sm">
              <Plus className="size-4" />
              Create a link
            </Button>
          }
        />
      </div>
    </div>
  );
}
