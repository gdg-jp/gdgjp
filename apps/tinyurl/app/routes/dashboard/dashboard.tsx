import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icons,
  Input,
  PageHeader,
  Stack,
} from "@gdgjp/design-system";
import { Suspense, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Await } from "react-router";
import { DashboardDisplayMenu } from "~/features/dashboard/components/display-menu";
import { shortHostOf } from "~/features/dashboard/components/results";
import { LinksSkeleton } from "~/features/dashboard/components/results";
import { DashboardResults } from "~/features/dashboard/components/results";
import { EmptyState } from "~/features/dashboard/components/results";
import {
  BUILT_IN_DISPLAY_DEFAULTS,
  DISPLAY_PREFERENCES_KEY,
  type DisplayPreferences,
  readDisplayPreferences,
} from "~/features/dashboard/display-preferences";
import type { DisplayLayout, DisplayProperty } from "~/features/dashboard/display-preferences";
import { loader as loadPage } from "~/features/dashboard/page.server";
import type { DashboardPageData } from "~/features/dashboard/page.server";
import type { CampaignFilter, FolderFilter, Scope, SortKey } from "~/features/dashboard/view.types";
import { CreateLinkDialog } from "~/features/links/components/create-link-dialog";
import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/dashboard";

export function meta() {
  return [{ title: "Links — GDG Japan Links" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

function shellUser(loaderData: DashboardPageData) {
  return {
    email: loaderData.user.email,
    image: loaderData.user.image,
    name: loaderData.user.name,
  };
}

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
    folders,
  } = loaderData;
  const user = shellUser(loaderData);
  const shortHost = shortHostOf(shortUrlBase);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("unclassified");
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [layout, setLayout] = useState<DisplayLayout>("cards");
  const [showArchived, setShowArchived] = useState(false);
  const [displayProperties, setDisplayProperties] = useState<DisplayProperty[]>(
    BUILT_IN_DISPLAY_DEFAULTS.properties,
  );
  const [defaultPreferences, setDefaultPreferences] =
    useState<DisplayPreferences>(BUILT_IN_DISPLAY_DEFAULTS);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    try {
      const nextDefaults = readDisplayPreferences(window.localStorage);
      setLayout(nextDefaults.layout);
      setSort(nextDefaults.sort);
      setShowArchived(nextDefaults.showArchived);
      setDisplayProperties(nextDefaults.properties);
      setDefaultPreferences(nextDefaults);
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
  const folderFilterLabel =
    folderFilter === "all"
      ? "All folders"
      : folderFilter === "unfiled"
        ? "Unfiled"
        : (folders.find((folder) => folder.id === Number(folderFilter.slice(7)))?.name ?? "Folder");
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  return (
    <DashboardShell user={user}>
      <Stack className="mx-auto w-full min-w-0 max-w-6xl">
        <PageHeader
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
                  <Icons name="Plus" aria-hidden="true" className="size-4" />
                  Create link
                  <kbd className="ml-1 rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wider">
                    C
                  </kbd>
                </Button>
              }
            />
          }
        />

        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="min-w-0 justify-start">
                  <Icons name="SlidersHorizontal" aria-hidden="true" className="size-4" />
                  <span className="truncate">Filter</span>
                  <Icons
                    name="ChevronDown"
                    aria-hidden="true"
                    className="ml-auto size-4 text-muted sm:hidden"
                  />
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
                <Button variant="outline" size="sm" className="min-w-0 justify-start sm:max-w-56">
                  <Icons name="Folder" aria-hidden="true" className="size-4" />
                  <span className="truncate">{folderFilterLabel}</span>
                  <Icons
                    name="ChevronDown"
                    aria-hidden="true"
                    className="ml-auto size-4 shrink-0 text-muted sm:hidden"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
                <DropdownMenuLabel>Folder</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={folderFilter === "all"}
                  onCheckedChange={() => setFolderFilter("all")}
                >
                  All folders
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={folderFilter === "unfiled"}
                  onCheckedChange={() => setFolderFilter("unfiled")}
                >
                  Unfiled
                </DropdownMenuCheckboxItem>
                {folders.length > 0 ? <DropdownMenuSeparator /> : null}
                {folders.map((folder) => (
                  <DropdownMenuCheckboxItem
                    key={folder.id}
                    checked={folderFilter === `folder:${folder.id}`}
                    onCheckedChange={() => setFolderFilter(`folder:${folder.id}`)}
                  >
                    {folder.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="min-w-0 justify-start sm:max-w-56">
                  <Icons name="RadioTower" aria-hidden="true" className="size-4" />
                  <span className="truncate">{campaignFilterLabel}</span>
                  <Icons
                    name="ChevronDown"
                    aria-hidden="true"
                    className="ml-auto size-4 shrink-0 text-muted sm:hidden"
                  />
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
              triggerClassName="min-w-0 justify-start"
            />
          </div>

          <div className="relative w-full sm:max-w-xs">
            <Icons
              name="Search"
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by short link or URL"
              aria-label="Search links"
              className="h-8 w-full pl-8 text-sm"
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
                <>
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
                    folderFilter={folderFilter}
                    layout={layout}
                    showArchived={showArchived}
                    displayProperties={displayProperties}
                    channelById={channelById}
                    folderById={folderById}
                    shortUrlBase={shortUrlBase}
                    shortHost={shortHost}
                  />
                </>
              )}
            </Await>
          </Suspense>
        )}
      </Stack>
    </DashboardShell>
  );
}
