import { Button, Icons, Skeleton } from "@gdgjp/design-system";
import { useMemo } from "react";
import type { UserSummary } from "~/features/auth/user.repository";
import type { DisplayLayout, DisplayProperty } from "~/features/dashboard/display-preferences";
import type { DashboardPageData } from "~/features/dashboard/page.server";
import type { CampaignFilter, FolderFilter, Scope, SortKey } from "~/features/dashboard/view.types";
import { CreateLinkDialog } from "~/features/links/components/create-link-dialog";
import type { LinkCardItem, LinkOwner } from "~/features/links/components/link-card";
import { LinkList } from "~/features/links/components/link-list";
import type { Link as DbLink } from "~/features/links/link-record";
import type { Tag as DbTag } from "~/features/tags/tag-record";

export function ownerOf(owners: Record<string, UserSummary>, id: string): LinkOwner | undefined {
  const u = owners[id];
  if (!u) return { id, email: "", name: "", image: null };
  return { id: u.id, email: u.email, name: u.name, image: u.image };
}

export function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

export function LinksSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading link statistics">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function DashboardResults({
  ownLinks,
  sharedLinks,
  owners,
  tagsByLinkId,
  clicks,
  scope,
  query,
  sort,
  campaignFilter,
  folderFilter,
  layout,
  showArchived,
  displayProperties,
  channelById,
  folderById,
  shortUrlBase,
  shortHost,
}: {
  ownLinks: DbLink[];
  sharedLinks: DbLink[];
  owners: Record<string, UserSummary>;
  tagsByLinkId: DashboardPageData["tagsByLinkId"];
  clicks: Record<string, number>;
  scope: Scope;
  query: string;
  sort: SortKey;
  campaignFilter: CampaignFilter;
  folderFilter: FolderFilter;
  layout: DisplayLayout;
  showArchived: boolean;
  displayProperties: DisplayProperty[];
  channelById: Map<number, DashboardPageData["campaignChannelCatalog"][number]>;
  folderById: Map<number, DashboardPageData["folders"][number]>;
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
      folder: link.folderId ? folderById.get(link.folderId) : undefined,
    });
    const own = ownLinks.map(toItem);
    const shared = sharedLinks.map(toItem);
    let combined = scope === "own" ? own : scope === "shared" ? shared : [...own, ...shared];

    if (!showArchived) combined = combined.filter((item) => item.link.archivedAt === null);

    if (folderFilter === "unfiled") {
      combined = combined.filter((item) => item.link.folderId === null);
    } else if (folderFilter.startsWith("folder:")) {
      const folderId = Number(folderFilter.slice("folder:".length));
      combined = combined.filter((item) => item.link.folderId === folderId);
    }

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
    folderFilter,
    channelById,
    folderById,
    showArchived,
  ]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-surface p-10 text-center text-sm text-muted">
        No links match your filters.
      </div>
    );
  }

  const accessibleCount = showArchived
    ? ownLinks.length + sharedLinks.length
    : [...ownLinks, ...sharedLinks].filter((link) => link.archivedAt === null).length;

  return (
    <>
      <LinkList
        items={items}
        shortUrlBase={shortUrlBase}
        shortHost={shortHost}
        layout={layout}
        properties={displayProperties}
      />
      <p className="text-center text-xs text-muted">
        Viewing 1–{items.length} of {accessibleCount} links
      </p>
    </>
  );
}

export function EmptyState({
  availableTags,
  campaignChannelOptions,
  chapters,
  shortUrlBase,
  domainOptions,
}: {
  availableTags: DbTag[];
  campaignChannelOptions: DashboardPageData["campaignChannelOptions"];
  chapters: DashboardPageData["chapters"];
  shortUrlBase: string;
  domainOptions: DashboardPageData["domainOptions"];
}) {
  return (
    <div className="rounded-xl border bg-surface p-10 text-center">
      <h2 className="text-lg font-medium">No links yet</h2>
      <p className="mt-1 text-sm text-muted">Create your first short link to get started.</p>
      <div className="mt-4 inline-block">
        <CreateLinkDialog
          availableTags={availableTags}
          campaignChannelOptions={campaignChannelOptions}
          chapters={chapters}
          shortUrlBase={shortUrlBase}
          domainOptions={domainOptions}
          trigger={
            <Button size="sm">
              <Icons name="Plus" aria-hidden="true" className="size-4" />
              Create a link
            </Button>
          }
        />
      </div>
    </div>
  );
}
