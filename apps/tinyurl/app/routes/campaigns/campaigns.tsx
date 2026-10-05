import { Alert, Button, Icons, PageHeader, Stack } from "@gdgjp/design-system";
import { Suspense } from "react";
import { Await } from "react-router";
import { CampaignDialog } from "~/features/campaigns/components/campaign-dialog";
import { CampaignResults } from "~/features/campaigns/components/campaign-list";
import { CampaignsSkeleton } from "~/features/campaigns/components/campaign-list";
import { loader as loadPage, action as mutatePage } from "~/features/campaigns/list.server";

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
      <Stack className="mx-auto w-full min-w-0 max-w-6xl">
        {actionData && "error" in actionData ? (
          <Alert tone="danger" title="Error">
            {actionData.error}
          </Alert>
        ) : null}
        <PageHeader
          title="Campaigns"
          description={`Organize ${chapter.chapterSlug} links by event, channel, and source.`}
          actions={<CampaignDialog chapters={chapters} />}
        />

        <Suspense fallback={<CampaignsSkeleton />}>
          <Await resolve={campaigns}>
            {(resolvedCampaigns) => (
              <CampaignResults campaigns={resolvedCampaigns} chapters={chapters} />
            )}
          </Await>
        </Suspense>

        <div className="flex items-center gap-2 rounded-lg bg-surface/40 px-4 py-3 text-sm text-muted">
          <Icons name="ChartColumnIncreasing" aria-hidden="true" className="size-4" />
          Click analytics are available inside each campaign.
        </div>
      </Stack>
    </DashboardShell>
  );
}
