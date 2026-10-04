import { BarChart3, Plus } from "lucide-react";
import { Suspense } from "react";
import { Await } from "react-router";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CampaignDialog } from "~/features/campaigns/components/campaign-dialog";
import { CampaignResults } from "~/features/campaigns/components/campaign-list";
import { CampaignsSkeleton } from "~/features/campaigns/components/campaign-list";
import { loader as loadPage, action as mutatePage } from "~/features/campaigns/list.server";

import { DashboardPage, DashboardPageHeader } from "~/layouts/dashboard-page";
import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/campaigns";

export function meta() {
  return [{ title: "Campaigns — GDG Japan Links" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export function action(args: Route.ActionArgs) {
  return mutatePage(args);
}

export default function Campaigns({ loaderData, actionData }: Route.ComponentProps) {
  const { user, chapter, chapters, campaigns } = loaderData;

  return (
    <DashboardShell user={user}>
      <DashboardPage className="pb-20 md:pb-0">
        {actionData && "error" in actionData ? (
          <Alert variant="destructive">
            <AlertDescription>{actionData.error}</AlertDescription>
          </Alert>
        ) : null}
        <DashboardPageHeader
          title="Campaigns"
          description={`Organize ${chapter.chapterSlug} links by event, channel, and source.`}
          actionsClassName="hidden sm:flex"
          actions={<CampaignDialog chapters={chapters} />}
        />

        <Suspense fallback={<CampaignsSkeleton />}>
          <Await resolve={campaigns}>
            {(resolvedCampaigns) => (
              <CampaignResults campaigns={resolvedCampaigns} chapters={chapters} />
            )}
          </Await>
        </Suspense>

        <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <BarChart3 className="size-4" />
          Click analytics are available inside each campaign.
        </div>
      </DashboardPage>

      <div className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur md:hidden">
        <CampaignDialog
          chapters={chapters}
          trigger={
            <Button className="w-full">
              <Plus className="size-4" />
              Create campaign
            </Button>
          }
        />
      </div>
    </DashboardShell>
  );
}
