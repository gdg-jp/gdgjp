import { ChevronsUpDown, FolderTree, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
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
import { clicksByLinkId } from "~/lib/analytics-engine";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  type Link as DbLink,
  type Tag as DbTag,
  type UserSummary,
  getUsersByIds,
  listCampaignMedia,
  listCampaignsForChapterWithCounts,
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
  const { user, chapter } = await requireUserWithChapter(env, args.request);
  const [personalLinks, chapterLinks, sharedLinks, publicLinks, userTags, chapterTags, campaigns] =
    await Promise.all([
      listLinksForUser(env.DB, user.id),
      listLinksForChapter(env.DB, chapter.chapterId),
      listLinksAccessibleByEmail(env.DB, user.email, chapter.chapterId),
      listPublicLinks(env.DB),
      listTagsForUser(env.DB, user.id),
      listTagsForChapter(env.DB, chapter.chapterId),
      listCampaignsForChapterWithCounts(env.DB, chapter.chapterId, true),
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

  const mediaByCampaign = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaign,
      media: await listCampaignMedia(env.DB, campaign.id, true),
    })),
  );

  const [clickMap, owners] = await Promise.all([
    clicksByLinkId(env, linkIds).catch((err) => {
      console.error("Analytics Engine query failed (clicksByLinkId):", err);
      return new Map<string, number>();
    }),
    ownerIds.length > 0
      ? getUsersByIds(env.DB, ownerIds).catch(() => ({}) as Record<string, UserSummary>)
      : Promise.resolve({} as Record<string, UserSummary>),
  ]);
  const clicks: Record<string, number> = {};
  for (const [id, n] of clickMap) clicks[id] = n;

  return {
    user,
    chapter,
    ownLinks,
    sharedLinks: sharedFiltered,
    owners,
    clicks,
    availableTags: [...userTags, ...chapterTags],
    campaignMediaCatalog: mediaByCampaign.flatMap(({ campaign, media }) =>
      media.map((medium) => ({
        id: medium.id,
        mediaId: medium.id,
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignCode: campaign.code,
        campaignArchived: campaign.archivedAt !== null,
        mediaName: medium.name,
        mediaCode: medium.code,
        mediaArchived: medium.archivedAt !== null,
      })),
    ),
    campaignMediaOptions: mediaByCampaign.flatMap(({ campaign, media }) =>
      campaign.archivedAt === null
        ? media
            .filter((medium) => medium.archivedAt === null)
            .map((medium) => ({
              id: medium.id,
              mediaId: medium.id,
              campaignId: campaign.id,
              campaignName: campaign.name,
              campaignCode: campaign.code,
              mediaName: medium.name,
              mediaCode: medium.code,
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
type CampaignFilter = "all" | "unclassified" | `campaign:${number}` | `media:${number}`;

function ownerOf(owners: Record<string, UserSummary>, id: string): LinkOwner | undefined {
  const u = owners[id];
  if (!u) return { id, email: "", name: "" };
  return { id: u.id, email: u.email, name: u.name };
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
    clicks,
    availableTags,
    campaignMediaCatalog,
    campaignMediaOptions,
    shortUrlBase,
  } = loaderData;
  const user = shellUser(loaderData);
  const shortHost = shortHostOf(shortUrlBase);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");

  const mediaById = useMemo(
    () => new Map(campaignMediaCatalog.map((option) => [option.id, option])),
    [campaignMediaCatalog],
  );

  const items = useMemo<LinkCardItem[]>(() => {
    const own: LinkCardItem[] = ownLinks.map((link) => ({
      link,
      owner: ownerOf(owners, link.ownerUserId),
      clicks: clicks[link.id] ?? 0,
      campaign: link.campaignMediaId ? mediaById.get(link.campaignMediaId) : undefined,
    }));
    const shared: LinkCardItem[] = sharedLinks.map((link) => ({
      link,
      owner: ownerOf(owners, link.ownerUserId),
      clicks: clicks[link.id] ?? 0,
      campaign: link.campaignMediaId ? mediaById.get(link.campaignMediaId) : undefined,
    }));
    let combined: LinkCardItem[];
    if (scope === "own") combined = own;
    else if (scope === "shared") combined = shared;
    else combined = [...own, ...shared];

    if (campaignFilter === "unclassified") {
      combined = combined.filter((item) => item.link.campaignMediaId === null);
    } else if (campaignFilter.startsWith("campaign:")) {
      const campaignId = Number(campaignFilter.slice("campaign:".length));
      combined = combined.filter((item) => item.campaign?.campaignId === campaignId);
    } else if (campaignFilter.startsWith("media:")) {
      const mediaId = Number(campaignFilter.slice("media:".length));
      combined = combined.filter((item) => item.link.campaignMediaId === mediaId);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      combined = combined.filter((it) => {
        return (
          it.link.slug.toLowerCase().includes(q) ||
          it.link.destinationUrl.toLowerCase().includes(q) ||
          (it.link.title?.toLowerCase().includes(q) ?? false) ||
          (it.link.description?.toLowerCase().includes(q) ?? false) ||
          (it.campaign?.campaignName.toLowerCase().includes(q) ?? false) ||
          (it.campaign?.mediaName.toLowerCase().includes(q) ?? false)
        );
      });
    }

    const sorted = [...combined];
    if (sort === "newest") sorted.sort((a, b) => b.link.createdAt - a.link.createdAt);
    else if (sort === "oldest") sorted.sort((a, b) => a.link.createdAt - b.link.createdAt);
    else sorted.sort((a, b) => b.clicks - a.clicks);
    return sorted;
  }, [ownLinks, sharedLinks, owners, clicks, scope, query, sort, campaignFilter, mediaById]);

  const campaignFilterLabel = useMemo(() => {
    if (campaignFilter === "all") return "All campaigns";
    if (campaignFilter === "unclassified") return "Unclassified";
    if (campaignFilter.startsWith("campaign:")) {
      const campaignId = Number(campaignFilter.slice("campaign:".length));
      return (
        campaignMediaCatalog.find((option) => option.campaignId === campaignId)?.campaignName ??
        "Campaign"
      );
    }
    const mediaId = Number(campaignFilter.slice("media:".length));
    const option = mediaById.get(mediaId);
    return option ? `${option.campaignName} / ${option.mediaName}` : "Media";
  }, [campaignFilter, campaignMediaCatalog, mediaById]);

  const campaignGroups = useMemo(() => {
    const groups = new Map<
      number,
      { id: number; name: string; media: typeof campaignMediaCatalog }
    >();
    for (const option of campaignMediaCatalog) {
      const group = groups.get(option.campaignId) ?? {
        id: option.campaignId,
        name: option.campaignName,
        media: [],
      };
      group.media.push(option);
      groups.set(option.campaignId, group);
    }
    return [...groups.values()];
  }, [campaignMediaCatalog]);

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
            campaignMediaOptions={campaignMediaOptions}
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
                    {campaign.media.map((medium) => (
                      <DropdownMenuCheckboxItem
                        key={medium.id}
                        checked={campaignFilter === `media:${medium.id}`}
                        onCheckedChange={() => setCampaignFilter(`media:${medium.id}`)}
                        className="pl-8"
                      >
                        {medium.mediaName}
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
            campaignMediaOptions={campaignMediaOptions}
            shortUrlBase={shortUrlBase}
          />
        ) : items.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
            No links match your filters.
          </div>
        ) : (
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
        )}

        {totalCount > 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            {items.length > 0
              ? `Viewing 1–${items.length} of ${totalCount} links`
              : `Viewing 0 of ${totalCount} links`}
          </p>
        ) : null}
      </div>
    </DashboardShell>
  );
}

function EmptyState({
  availableTags,
  campaignMediaOptions,
  shortUrlBase,
}: {
  availableTags: DbTag[];
  campaignMediaOptions: Route.ComponentProps["loaderData"]["campaignMediaOptions"];
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
          campaignMediaOptions={campaignMediaOptions}
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
