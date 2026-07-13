import { ChevronsUpDown, FolderTree, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { Await } from "react-router";
import { CreateLinkDialog } from "~/components/create-link-dialog";
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
  listTagsForUser,
} from "~/lib/db";
import type { Route } from "./+types/dashboard";

export function meta() {
  return [{ title: "Links — GDG Japan Links" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const [personalLinks, chapterLinks, sharedLinks, publicLinks, userTags, chapterTags, campaigns] =
    await Promise.all([
      listLinksForUser(env.DB, user.id),
      listLinksForChapter(env.DB, chapter.chapterId),
      listLinksAccessibleByEmail(env.DB, user.email, chapter.chapterId),
      listPublicLinks(env.DB),
      listTagsForUser(env.DB, user.id),
      listTagsForChapter(env.DB, chapter.chapterId),
      listCampaignsForChaptersWithCounts(
        env.DB,
        chapters.map((item) => item.chapterId),
        true,
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

  const [channelsByCampaign, owners] = await Promise.all([
    Promise.all(
      campaigns.map(async (campaign) => ({
        campaign,
        channels: await listCampaignChannels(env.DB, campaign.id, true),
      })),
    ),
    ownerIds.length > 0
      ? getUsersByIds(env.DB, ownerIds).catch(() => ({}) as Record<string, UserSummary>)
      : Promise.resolve({} as Record<string, UserSummary>),
  ]);

  return {
    user,
    chapter,
    chapters,
    ownLinks,
    sharedLinks: sharedFiltered,
    owners,
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
  };
}

function shellUser(loaderData: Route.ComponentProps["loaderData"]) {
  return { email: loaderData.user.email, name: loaderData.user.name };
}

type Scope = "all" | "own" | "shared";
type SortKey = "newest" | "oldest" | "mostClicks";
type CampaignFilter = "all" | "unclassified" | `campaign:${number}` | `channel:${number}`;

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
    availableTags,
    campaignChannelCatalog,
    campaignChannelOptions,
    chapters,
    shortUrlBase,
  } = loaderData;
  const user = shellUser(loaderData);
  const shortHost = shortHostOf(shortUrlBase);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");

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
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight"
            onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}
            aria-label="Toggle sort"
          >
            Links
            <ChevronsUpDown className="size-5 text-muted-foreground" />
          </button>
          <CreateLinkDialog
            availableTags={availableTags}
            campaignChannelOptions={campaignChannelOptions}
            chapters={chapters}
            shortUrlBase={shortUrlBase}
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
        </div>

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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <SlidersHorizontal className="size-4 rotate-90" />
                  Display
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={sort === "newest"}
                  onCheckedChange={() => setSort("newest")}
                >
                  Newest first
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={sort === "oldest"}
                  onCheckedChange={() => setSort("oldest")}
                >
                  Oldest first
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={sort === "mostClicks"}
                  onCheckedChange={() => setSort("mostClicks")}
                >
                  Most clicks
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
          />
        ) : (
          <Suspense fallback={<LinksSkeleton />}>
            <Await resolve={loaderData.clicks}>
              {(clicks) => (
                <DashboardResults
                  ownLinks={ownLinks}
                  sharedLinks={sharedLinks}
                  owners={owners}
                  clicks={clicks}
                  scope={scope}
                  query={query}
                  sort={sort}
                  campaignFilter={campaignFilter}
                  channelById={channelById}
                  shortUrlBase={shortUrlBase}
                  shortHost={shortHost}
                />
              )}
            </Await>
          </Suspense>
        )}
      </div>
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
  clicks,
  scope,
  query,
  sort,
  campaignFilter,
  channelById,
  shortUrlBase,
  shortHost,
}: {
  ownLinks: DbLink[];
  sharedLinks: DbLink[];
  owners: Record<string, UserSummary>;
  clicks: Record<string, number>;
  scope: Scope;
  query: string;
  sort: SortKey;
  campaignFilter: CampaignFilter;
  channelById: Map<number, Route.ComponentProps["loaderData"]["campaignChannelCatalog"][number]>;
  shortUrlBase: string;
  shortHost: string;
}) {
  const items = useMemo<LinkCardItem[]>(() => {
    const toItem = (link: DbLink): LinkCardItem => ({
      link,
      owner: ownerOf(owners, link.ownerUserId),
      clicks: clicks[link.id] ?? 0,
      campaign: link.campaignChannelId ? channelById.get(link.campaignChannelId) : undefined,
    });
    const own = ownLinks.map(toItem);
    const shared = sharedLinks.map(toItem);
    let combined = scope === "own" ? own : scope === "shared" ? shared : [...own, ...shared];

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
  }, [ownLinks, sharedLinks, owners, clicks, scope, query, sort, campaignFilter, channelById]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
        No links match your filters.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <LinkCard
            key={item.link.id}
            item={item}
            shortUrlBase={shortUrlBase}
            shortHost={shortHost}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Viewing 1–{items.length} of {ownLinks.length + sharedLinks.length} links
      </p>
    </>
  );
}

function EmptyState({
  availableTags,
  campaignChannelOptions,
  chapters,
  shortUrlBase,
}: {
  availableTags: DbTag[];
  campaignChannelOptions: Route.ComponentProps["loaderData"]["campaignChannelOptions"];
  chapters: Route.ComponentProps["loaderData"]["chapters"];
  shortUrlBase: string;
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
