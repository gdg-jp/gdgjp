import { ChevronsUpDown, Plus, Search, SlidersHorizontal } from "lucide-react";
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
  listLinksAccessibleByEmail,
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
  const [ownLinks, sharedLinks, publicLinks, userTags, chapterTags] = await Promise.all([
    listLinksForUser(env.DB, user.id),
    listLinksAccessibleByEmail(env.DB, user.email, chapter.chapterId),
    listPublicLinks(env.DB),
    listTagsForUser(env.DB, user.id),
    listTagsForChapter(env.DB, chapter.chapterId),
  ]);
  const ownIds = new Set(ownLinks.map((l) => l.id));
  const sharedFromPerms = sharedLinks.filter((l) => !ownIds.has(l.id));
  const sharedIds = new Set(sharedFromPerms.map((l) => l.id));
  const sharedFromPublic = publicLinks.filter(
    (l) => !ownIds.has(l.id) && !sharedIds.has(l.id),
  );
  const sharedFiltered = [...sharedFromPerms, ...sharedFromPublic];
  const allLinks: DbLink[] = [...ownLinks, ...sharedFiltered];
  const ownerIds = [...new Set(allLinks.map((l) => l.ownerUserId))];
  const linkIds = allLinks.map((l) => l.id);

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
    shortUrlBase: env.SHORT_URL_BASE,
  };
}

function shellUser(loaderData: Route.ComponentProps["loaderData"]) {
  return { email: loaderData.user.email, name: loaderData.user.name };
}

type Scope = "all" | "own" | "shared";
type SortKey = "newest" | "oldest" | "mostClicks";

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
  const { ownLinks, sharedLinks, owners, clicks, availableTags, shortUrlBase } = loaderData;
  const user = shellUser(loaderData);
  const shortHost = shortHostOf(shortUrlBase);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const items = useMemo<LinkCardItem[]>(() => {
    const own: LinkCardItem[] = ownLinks.map((link) => ({
      link,
      owner: ownerOf(owners, link.ownerUserId),
      clicks: clicks[link.id] ?? 0,
    }));
    const shared: LinkCardItem[] = sharedLinks.map((link) => ({
      link,
      owner: ownerOf(owners, link.ownerUserId),
      clicks: clicks[link.id] ?? 0,
    }));
    let combined: LinkCardItem[];
    if (scope === "own") combined = own;
    else if (scope === "shared") combined = shared;
    else combined = [...own, ...shared];

    const q = query.trim().toLowerCase();
    if (q) {
      combined = combined.filter((it) => {
        return (
          it.link.slug.toLowerCase().includes(q) ||
          it.link.destinationUrl.toLowerCase().includes(q) ||
          (it.link.title?.toLowerCase().includes(q) ?? false)
        );
      });
    }

    const sorted = [...combined];
    if (sort === "newest") sorted.sort((a, b) => b.link.createdAt - a.link.createdAt);
    else if (sort === "oldest") sorted.sort((a, b) => a.link.createdAt - b.link.createdAt);
    else sorted.sort((a, b) => b.clicks - a.clicks);
    return sorted;
  }, [ownLinks, sharedLinks, owners, clicks, scope, query, sort]);

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
          <EmptyState availableTags={availableTags} shortUrlBase={shortUrlBase} />
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
  shortUrlBase,
}: {
  availableTags: DbTag[];
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
