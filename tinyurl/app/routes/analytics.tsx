import { ExternalLink, X } from "lucide-react";
import { Suspense } from "react";
import { Await, Link, useLocation, useNavigation, useSearchParams } from "react-router";
import {
  AnalyticsBarListCard,
  AnalyticsBarListSkeleton,
  AnalyticsClicksChartCard,
  AnalyticsDimensionCards,
} from "~/components/analytics/analytics-breakdown-cards";
import type { FilterSuggestions } from "~/components/analytics/analytics-filter-button";
import { AnalyticsFiltersBar } from "~/components/analytics/analytics-filters-bar";
import { HourlyChart } from "~/components/charts/hourly-chart";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  type Granularity,
  type QueryOpts,
  type TopRow,
  granularityFor,
  hourlyClicks,
  topByBlob,
  totalClicks,
} from "~/lib/analytics-engine";
import {
  type DimensionFilters,
  parseAnalyticsParams,
  serializeAnalyticsParams,
} from "~/lib/analytics-filters";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  getLinkById,
  listLinksAccessibleByEmail,
  listLinksForChapter,
  listLinksForUser,
  listPermissionsForLink,
} from "~/lib/db";
import { isLinkId } from "~/lib/id";
import { type ViewerContext, canViewLink } from "~/lib/permissions";
import type { Route } from "./+types/analytics";

export function meta({ data }: Route.MetaArgs) {
  if (data?.focus) {
    return [{ title: `${data.focus.slug} analytics — GDG Japan Links` }];
  }
  return [{ title: "Analytics — GDG Japan Links" }];
}

type AnalyticsData = {
  hourly: Awaited<ReturnType<typeof hourlyClicks>>;
  total: Awaited<ReturnType<typeof totalClicks>>;
  slugs: TopRow[];
  sources: TopRow[];
  referrers: TopRow[];
  countries: TopRow[];
  regions: TopRow[];
  cities: TopRow[];
  continents: TopRow[];
  browsers: TopRow[];
  oses: TopRow[];
  devices: TopRow[];
  granularity: Granularity;
};

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);

  const url = new URL(args.request.url);
  const linkIdParam = url.searchParams.get("linkId");
  let focus: { id: string; slug: string; destinationUrl: string; shortUrl: string } | null = null;
  let ids: string[];

  if (linkIdParam !== null) {
    if (!isLinkId(linkIdParam)) {
      throw new Response("Not found", { status: 404 });
    }
    const link = await getLinkById(env.DB, linkIdParam);
    if (!link) throw new Response("Not found", { status: 404 });
    const permissions = await listPermissionsForLink(env.DB, linkIdParam);
    const ctx: ViewerContext = { user, chapterId: chapter.chapterId };
    if (!canViewLink(ctx, link, permissions)) {
      throw new Response("Forbidden", { status: 403 });
    }
    focus = {
      id: link.id,
      slug: link.slug,
      destinationUrl: link.destinationUrl,
      shortUrl: `${env.SHORT_URL_BASE}/${link.slug}`,
    };
    ids = [linkIdParam];
  } else {
    const [own, chapterOwned, shared] = await Promise.all([
      listLinksForUser(env.DB, user.id),
      listLinksForChapter(env.DB, chapter.chapterId),
      listLinksAccessibleByEmail(env.DB, user.email, chapter.chapterId),
    ]);
    const idSet = new Set<string>([
      ...own.map((l) => l.id),
      ...chapterOwned.map((l) => l.id),
      ...shared.map((l) => l.id),
    ]);
    ids = [...idSet];
  }

  const { preset, window, filters } = parseAnalyticsParams(url.searchParams);
  const customStart = window.kind === "custom" ? window.startIso : undefined;
  const customEnd = window.kind === "custom" ? window.endIso : undefined;
  const granularity = granularityFor(window);

  const shellUser = { email: user.email, name: user.name };
  if (ids.length === 0) {
    return {
      user: shellUser,
      hasLinks: false as const,
      focus,
      analytics: null,
      suggestions: null,
      preset,
      customStart,
      customEnd,
      filters,
    };
  }

  function aeFallback<T>(label: string, fallback: T): (err: unknown) => T {
    return (err) => {
      console.error(`Analytics Engine query failed (${label}):`, err);
      return fallback;
    };
  }

  const opts: QueryOpts = { window, filters };

  const analytics: Promise<AnalyticsData> = Promise.all([
    hourlyClicks(env, ids, opts).catch(aeFallback("hourly", [])),
    totalClicks(env, ids, opts).catch(aeFallback("total", 0)),
    topByBlob(env, "slug", ids, 10, opts).catch(aeFallback("slug", [])),
    topByBlob(env, "source", ids, 10, opts).catch(aeFallback("source", [])),
    topByBlob(env, "referer", ids, 10, opts).catch(aeFallback("referer", [])),
    topByBlob(env, "country", ids, 10, opts).catch(aeFallback("country", [])),
    topByBlob(env, "region", ids, 10, opts).catch(aeFallback("region", [])),
    topByBlob(env, "city", ids, 10, opts).catch(aeFallback("city", [])),
    topByBlob(env, "continent", ids, 10, opts).catch(aeFallback("continent", [])),
    topByBlob(env, "browser", ids, 10, opts).catch(aeFallback("browser", [])),
    topByBlob(env, "os", ids, 10, opts).catch(aeFallback("os", [])),
    topByBlob(env, "device", ids, 10, opts).catch(aeFallback("device", [])),
  ]).then(
    ([
      hourly,
      total,
      slugs,
      sources,
      referrers,
      countries,
      regions,
      cities,
      continents,
      browsers,
      oses,
      devices,
    ]) => ({
      hourly,
      total,
      slugs,
      sources,
      referrers,
      countries,
      regions,
      cities,
      continents,
      browsers,
      oses,
      devices,
      granularity,
    }),
  );

  const suggestions: Promise<FilterSuggestions> = analytics.then((d) => ({
    slug: d.slugs.map((r) => r.name).filter((n) => n !== "(unknown)"),
    source: d.sources.map((r) => r.name).filter((n) => n !== "(unknown)"),
    country: d.countries.map((r) => r.name).filter((n) => n !== "(unknown)"),
    city: d.cities.map((r) => r.name).filter((n) => n !== "(unknown)"),
    region: d.regions.map((r) => r.name).filter((n) => n !== "(unknown)"),
    continent: d.continents.map((r) => r.name).filter((n) => n !== "(unknown)"),
    browser: d.browsers.map((r) => r.name).filter((n) => n !== "(unknown)"),
    os: d.oses.map((r) => r.name).filter((n) => n !== "(unknown)"),
    device: d.devices.map((r) => r.name).filter((n) => n !== "(unknown)"),
    referer: d.referrers.map((r) => r.name).filter((n) => n !== "(unknown)"),
  }));

  return {
    user: shellUser,
    hasLinks: true as const,
    focus,
    analytics,
    suggestions,
    preset,
    customStart,
    customEnd,
    filters,
  };
}

function AnalyticsContent({
  data,
  filters,
  pending,
}: {
  data: AnalyticsData;
  filters: DimensionFilters;
  pending: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  function isolateTrend(dimension: "source" | "slug", row: TopRow) {
    if (row.name === "(unknown)") return;
    const params = serializeAnalyticsParams(searchParams, {
      filters: { ...filters, [dimension]: [row.name] },
    });
    setSearchParams(params, { preventScrollReset: true });
  }

  return (
    <>
      <AnalyticsClicksChartCard total={data.total} pending={pending}>
        {pending ? (
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <HourlyChart data={data.hourly} height={260} granularity={data.granularity} />
        )}
      </AnalyticsClicksChartCard>

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <AnalyticsBarListCard
          title="Sources"
          description="Select a row to isolate its trend."
          rows={data.sources}
          emptyLabel="No source data yet."
          loading={pending}
          loadingContent={<AnalyticsBarListSkeleton />}
          selectedKey={filters.source?.length === 1 ? filters.source[0] : undefined}
          onSelect={(row) => isolateTrend("source", row)}
        />
        <AnalyticsBarListCard
          title="Links"
          description="Select a row to isolate its trend."
          rows={data.slugs}
          emptyLabel="No clicks yet."
          loading={pending}
          loadingContent={<AnalyticsBarListSkeleton />}
          selectedKey={filters.slug?.length === 1 ? filters.slug[0] : undefined}
          onSelect={(row) => isolateTrend("slug", row)}
        />
      </div>
      <AnalyticsDimensionCards analytics={data} />
    </>
  );
}

function AnalyticsSkeleton() {
  const emptyDimensions = {
    referrers: [],
    countries: [],
    cities: [],
    regions: [],
    continents: [],
    devices: [],
    browsers: [],
    oses: [],
  };

  return (
    <>
      <AnalyticsClicksChartCard total={0} pending>
        <Skeleton className="h-[260px] w-full" />
      </AnalyticsClicksChartCard>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <AnalyticsBarListCard
          title="Sources"
          description="Select a row to isolate its trend."
          rows={[]}
          loading
          loadingContent={<AnalyticsBarListSkeleton />}
        />
        <AnalyticsBarListCard
          title="Links"
          description="Select a row to isolate its trend."
          rows={[]}
          loading
          loadingContent={<AnalyticsBarListSkeleton />}
        />
      </div>
      <AnalyticsDimensionCards analytics={emptyDimensions} loading />
    </>
  );
}

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const { user, hasLinks, focus, analytics, suggestions } = loaderData;
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
      <DashboardPage>
        <DashboardPageHeader
          title="Analytics"
          description={focus ? <span className="font-mono">{focus.shortUrl}</span> : undefined}
          actions={
            <>
              {focus ? (
                <Button asChild variant="outline" size="sm">
                  <a href={focus.destinationUrl} target="_blank" rel="noopener noreferrer">
                    Visit destination
                    <ExternalLink className="size-3" />
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
                <X className="size-4" />
                {focus.slug}
              </Link>
            </Button>
          </div>
        ) : null}

        {!hasLinks ? (
          <Card className="px-6 py-8 text-center">
            <p className="text-base font-medium">No links yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a link to start collecting analytics.
            </p>
          </Card>
        ) : (
          <Suspense fallback={<AnalyticsSkeleton />}>
            <Await resolve={analytics}>
              {(data) =>
                data ? (
                  <AnalyticsContent
                    data={data}
                    filters={displayParams.filters}
                    pending={analyticsPending}
                  />
                ) : null
              }
            </Await>
          </Suspense>
        )}
      </DashboardPage>
    </DashboardShell>
  );
}
