import { ChevronLeft } from "lucide-react";
import { Suspense } from "react";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { Await, Link, useLocation, useNavigation, useSearchParams } from "react-router";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { parseAnalyticsParams } from "~/features/analytics/analytics-filters";
import { shouldReloadCampaign } from "~/features/campaigns/campaign-navigation";
import { resolveCampaignScope } from "~/features/campaigns/campaign-navigation";
import { CampaignAcquisitionPanel } from "~/features/campaigns/components/acquisition-analytics";
import { ChannelCard } from "~/features/campaigns/components/channel-card";
import { CreateChannelDialog } from "~/features/campaigns/components/channel-dialogs";
import { AssignLinksDialog } from "~/features/campaigns/components/channel-dialogs";
import { CampaignPanelSkeleton } from "~/features/campaigns/components/detail-analytics";
import { CampaignAnalyticsSkeleton } from "~/features/campaigns/components/detail-analytics";
import { CampaignAnalyticsPanel } from "~/features/campaigns/components/detail-analytics";
import { ImportConnpassDialog } from "~/features/campaigns/components/participant-file-dialog";
import { loader as loadPage, action as mutatePage } from "~/features/campaigns/detail.server";

import { DashboardPage, DashboardPageHeader } from "~/layouts/dashboard-page";
import { DashboardShell } from "~/layouts/dashboard-shell";
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

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export function action(args: Route.ActionArgs) {
  return mutatePage(args);
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
    participantSnapshot,
    acquisition,
    acquisitionPreset,
    acquisitionStart,
    acquisitionEnd,
    acquisitionBucket,
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
  const activeView =
    searchParams.get("view") === "analytics"
      ? "analytics"
      : searchParams.get("view") === "acquisition"
        ? "acquisition"
        : "channels";
  const analyticsPending =
    navigatingWithinCampaign &&
    (activeView === "analytics" ||
      new URLSearchParams(navigation.location?.search).get("view") === "analytics");
  const acquisitionPending =
    navigatingWithinCampaign &&
    (activeView === "acquisition" ||
      new URLSearchParams(navigation.location?.search).get("view") === "acquisition");
  const activeChannels = channels.filter((item) => item.archivedAt === null);

  function setView(view: "channels" | "analytics" | "acquisition") {
    const next = new URLSearchParams(searchParams);
    if (view !== "channels") next.set("view", view);
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
            </>
          }
        />

        <div
          className="relative grid w-full grid-cols-3 rounded-lg bg-muted p-1 sm:w-fit"
          role="tablist"
          aria-label="Campaign view"
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-1 left-1 w-[calc(33.333%-0.25rem)] rounded-md bg-background shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none",
              activeView === "analytics" && "translate-x-full",
              activeView === "acquisition" && "translate-x-[200%]",
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
            Clicks
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            role="tab"
            id="acquisition-tab"
            aria-selected={activeView === "acquisition"}
            aria-controls="acquisition-panel"
            onClick={() => setView("acquisition")}
            className={cn(
              "relative z-10 min-w-24 transition-colors duration-200 aria-selected:hover:bg-transparent",
              activeView === "acquisition" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Acqquisitions
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
        ) : activeView === "analytics" ? (
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
                  includeAutomated={parseAnalyticsParams(scopeSearchParams).includeAutomated}
                  bucket={bucket}
                  scopeSearchParams={scopeSearchParams}
                  scopePending={scopePending}
                  analyticsPending={analyticsPending}
                />
              )}
            </Await>
          </Suspense>
        ) : (
          <CampaignAcquisitionPanel
            snapshot={participantSnapshot}
            analytics={acquisition}
            preset={acquisitionPreset}
            startIso={acquisitionStart}
            endIso={acquisitionEnd}
            bucket={acquisitionBucket}
            pending={acquisitionPending}
            importControl={
              <ImportConnpassDialog
                channels={activeChannels}
                triggerLabel={participantSnapshot ? "Update connpass CSV" : "Import connpass CSV"}
              />
            }
          />
        )}
      </DashboardPage>
    </DashboardShell>
  );
}
