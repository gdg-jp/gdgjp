import {
  type BlobTrendPoint,
  type Granularity,
  type QueryOpts,
  type TopRow,
  granularityFor,
  granularityForTimeBucket,
  hourlyClicks,
  hourlyClicksByBlob,
  parseTimeBucket,
  timeBucketFor,
  timeBucketLabel,
  timeBucketParam,
  topByBlob,
  totalClicks,
} from "~/features/analytics/analytics-engine";
import { parseAnalyticsParams } from "~/features/analytics/analytics-filters";
import type { FilterSuggestions } from "~/features/analytics/components/analytics/analytics-filter-button";
import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import {
  type ViewerContext,
  canViewLink,
  getLinkById,
  listPermissionsForLink,
} from "~/features/links";
import { isLinkId } from "~/features/links/id";
import {
  listLinksAccessibleByEmail,
  listLinksForChapter,
  listLinksForUser,
} from "~/features/links/link-queries";
import type { PageRequestArgs } from "~/http/request";

export type AnalyticsData = {
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
  bucketLabel: string;
  sourceTrend: BlobTrendPoint[];
  linkTrend: BlobTrendPoint[];
};

export async function loader(args: PageRequestArgs) {
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

  const { preset, window, filters, includeAutomated } = parseAnalyticsParams(url.searchParams);
  const requestedBucket = parseTimeBucket(url.searchParams.get("bucket"));
  const effectiveBucket = requestedBucket ?? timeBucketFor(window);
  const customStart = window.kind === "custom" ? window.startIso : undefined;
  const customEnd = window.kind === "custom" ? window.endIso : undefined;
  const granularity = granularityFor(window);

  const shellUser = { email: user.email, image: user.image, name: user.name };
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
      includeAutomated,
      bucket: requestedBucket ? timeBucketParam(requestedBucket) : "",
    };
  }

  function aeFallback<T>(label: string, fallback: T): (err: unknown) => T {
    return (err) => {
      console.error(`Analytics Engine query failed (${label}):`, err);
      return fallback;
    };
  }

  const opts: QueryOpts = {
    window,
    filters,
    bucket: requestedBucket ?? undefined,
    includeAutomated,
  };

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
    hourlyClicksByBlob(env, "source", ids, opts).catch(aeFallback("sourceTrend", [])),
    hourlyClicksByBlob(env, "slug", ids, opts).catch(aeFallback("linkTrend", [])),
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
      sourceTrend,
      linkTrend,
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
      granularity: requestedBucket ? granularityForTimeBucket(requestedBucket) : granularity,
      bucketLabel: timeBucketLabel(effectiveBucket),
      sourceTrend,
      linkTrend,
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
    includeAutomated,
    bucket: requestedBucket ? timeBucketParam(requestedBucket) : "",
  };
}

export type AnalyticsPageData = Awaited<ReturnType<typeof loader>>;
export type AnalyticsPageAction = undefined;
