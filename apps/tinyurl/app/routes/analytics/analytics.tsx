import { Button, Card, Icons, PageHeader, Stack } from "@gdgjp/design-system";
import { Suspense } from "react";
import { Await, Link, useLocation, useNavigation, useSearchParams } from "react-router";
import { parseAnalyticsParams } from "~/features/analytics/analytics-filters";
import type { FilterSuggestions } from "~/features/analytics/components/analytics/analytics-filter-button";
import { AnalyticsFiltersBar } from "~/features/analytics/components/analytics/analytics-filters-bar";
import { AnalyticsContent } from "~/features/analytics/components/overview";
import { AnalyticsSkeleton } from "~/features/analytics/components/overview";
import { loader as loadPage } from "~/features/analytics/page.server";

import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/analytics";

export function meta({ data }: Route.MetaArgs) {
  if (data?.focus) {
    return [{ title: `${data.focus.slug} analytics — GDG Japan Links` }];
  }
  return [{ title: "Analytics — GDG Japan Links" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const { user, hasLinks, focus, analytics, suggestions, bucket } = loaderData;
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigation = useNavigation();
  const navigatingWithinAnalytics = navigation.location?.pathname === location.pathname;
  const displaySearchParams = navigatingWithinAnalytics
    ? new URLSearchParams(navigation.location?.search)
    : searchParams;
  const displayParams = parseAnalyticsParams(displaySearchParams);
  const displayCustomStart =
    displayParams.window.kind === "custom" ? displayParams.window.startIso : undefined;
  const displayCustomEnd =
    displayParams.window.kind === "custom" ? displayParams.window.endIso : undefined;
  const analyticsPending = navigatingWithinAnalytics;

  return (
    <DashboardShell user={user}>
      <Stack className="mx-auto w-full min-w-0 max-w-6xl">
        <PageHeader
          title="Analytics"
          description={focus ? <span className="font-mono">{focus.shortUrl}</span> : undefined}
          actions={
            <>
              {focus ? (
                <Button asChild variant="outline" size="sm">
                  <a href={focus.destinationUrl} target="_blank" rel="noopener noreferrer">
                    Visit destination
                    <Icons name="ExternalLink" aria-hidden="true" className="size-3" />
                  </a>
                </Button>
              ) : null}
              <Suspense
                fallback={
                  <AnalyticsFiltersBar
                    preset={displayParams.preset}
                    startIso={displayCustomStart}
                    endIso={displayCustomEnd}
                    filters={displayParams.filters}
                    suggestions={{}}
                  />
                }
              >
                <Await resolve={suggestions ?? Promise.resolve({} as FilterSuggestions)}>
                  {(s) => (
                    <AnalyticsFiltersBar
                      preset={displayParams.preset}
                      startIso={displayCustomStart}
                      endIso={displayCustomEnd}
                      filters={displayParams.filters}
                      suggestions={s ?? {}}
                    />
                  )}
                </Await>
              </Suspense>
            </>
          }
        />

        {focus ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/analytics" prefetch="intent" aria-label="Clear link filter">
                <Icons name="X" aria-hidden="true" className="size-4" />
                {focus.slug}
              </Link>
            </Button>
          </div>
        ) : null}

        {!hasLinks ? (
          <Card className="px-6 py-8 text-center">
            <Stack>
              <p className="text-base font-medium">No links yet</p>
              <p className="mt-1 text-sm text-muted">
                Create a link to start collecting analytics.
              </p>
            </Stack>
          </Card>
        ) : (
          <Suspense fallback={<AnalyticsSkeleton />}>
            <Await resolve={analytics}>
              {(data) =>
                data ? (
                  <AnalyticsContent
                    data={data}
                    filters={displayParams.filters}
                    includeAutomated={displayParams.includeAutomated}
                    bucket={bucket}
                    pending={analyticsPending}
                  />
                ) : null
              }
            </Await>
          </Suspense>
        )}
      </Stack>
    </DashboardShell>
  );
}
