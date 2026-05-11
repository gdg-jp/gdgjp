import {
  CalendarRange,
  ExternalLink,
  Globe,
  Laptop,
  Link as LinkIcon,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { HourlyChart } from "~/components/charts/hourly-chart";
import { type BarTab, TabbedBarCard } from "~/components/charts/tabbed-bar-card";
import { DashboardShell } from "~/components/dashboard-shell";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { type TopRow, hourlyClicks, topByBlob, totalClicks } from "~/lib/analytics-engine";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  getLinkById,
  listLinksAccessibleByEmail,
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
    const [own, shared] = await Promise.all([
      listLinksForUser(env.DB, user.id),
      listLinksAccessibleByEmail(env.DB, user.email, chapter.chapterId),
    ]);
    const idSet = new Set<string>([...own.map((l) => l.id), ...shared.map((l) => l.id)]);
    ids = [...idSet];
  }

  const shellUser = { email: user.email, name: user.name };
  if (ids.length === 0) {
    return {
      user: shellUser,
      hasLinks: false as const,
      focus,
      hourly: [],
      total: 0,
      slugs: [],
      referrers: [],
      countries: [],
      regions: [],
      cities: [],
      continents: [],
      browsers: [],
      oses: [],
      devices: [],
    };
  }

  function aeFallback<T>(label: string, fallback: T): (err: unknown) => T {
    return (err) => {
      console.error(`Analytics Engine query failed (${label}):`, err);
      return fallback;
    };
  }
  const [
    hourly,
    total,
    slugs,
    referrers,
    countries,
    regions,
    cities,
    continents,
    browsers,
    oses,
    devices,
  ] = await Promise.all([
    hourlyClicks(env, ids).catch(aeFallback("hourly", [])),
    totalClicks(env, ids).catch(aeFallback("total", 0)),
    topByBlob(env, "slug", ids).catch(aeFallback("slug", [])),
    topByBlob(env, "referer", ids).catch(aeFallback("referer", [])),
    topByBlob(env, "country", ids).catch(aeFallback("country", [])),
    topByBlob(env, "region", ids).catch(aeFallback("region", [])),
    topByBlob(env, "city", ids).catch(aeFallback("city", [])),
    topByBlob(env, "continent", ids).catch(aeFallback("continent", [])),
    topByBlob(env, "browser", ids).catch(aeFallback("browser", [])),
    topByBlob(env, "os", ids).catch(aeFallback("os", [])),
    topByBlob(env, "device", ids).catch(aeFallback("device", [])),
  ]);

  return {
    user: shellUser,
    hasLinks: true as const,
    focus,
    hourly,
    total,
    slugs,
    referrers,
    countries,
    regions,
    cities,
    continents,
    browsers,
    oses,
    devices,
  };
}

const REGIONAL_OFFSET = 0x1f1e6 - "A".charCodeAt(0);

function countryFlag(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) return "🌐";
  return [...trimmed].map((c) => String.fromCodePoint(c.charCodeAt(0) + REGIONAL_OFFSET)).join("");
}

function CountryIcon({ row }: { row: TopRow }) {
  return <span className="text-base leading-none">{countryFlag(row.name)}</span>;
}

function ReferrerIcon({ row }: { row: TopRow }) {
  if (!row.name || row.name === "(unknown)") {
    return <LinkIcon className="size-4 text-muted-foreground" />;
  }
  try {
    const host = new URL(row.name).hostname || row.name;
    return host ? (
      <Globe className="size-4 text-muted-foreground" />
    ) : (
      <LinkIcon className="size-4 text-muted-foreground" />
    );
  } catch {
    return <LinkIcon className="size-4 text-muted-foreground" />;
  }
}

function DeviceIcon({ row }: { row: TopRow }) {
  const name = (row.name ?? "").toLowerCase();
  if (name.includes("mobile") || name.includes("phone")) {
    return <Smartphone className="size-4 text-muted-foreground" />;
  }
  if (name.includes("tablet")) {
    return <Tablet className="size-4 text-muted-foreground" />;
  }
  return <Laptop className="size-4 text-muted-foreground" />;
}

function ClicksTile({ total }: { total: number }) {
  return (
    <div className="flex max-w-xs flex-col gap-2 border-b-2 border-foreground pb-4">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="size-2 rounded-sm bg-gdg-blue" aria-hidden />
        Clicks
      </div>
      <p className="text-3xl font-medium tracking-tight">{total.toLocaleString()}</p>
    </div>
  );
}

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const {
    user,
    hasLinks,
    focus,
    hourly,
    total,
    slugs,
    referrers,
    countries,
    regions,
    cities,
    continents,
    browsers,
    oses,
    devices,
  } = loaderData;

  const linksTabs: BarTab[] = [
    { key: "links", label: "Short Links", rows: slugs, emptyLabel: "No clicks yet." },
  ];

  const referrerTabs: BarTab[] = [
    {
      key: "referrers",
      label: "Referrers",
      rows: referrers,
      emptyLabel: "No referrers yet.",
      renderIcon: (r) => <ReferrerIcon row={r} />,
    },
  ];

  const locationTabs: BarTab[] = [
    {
      key: "countries",
      label: "Countries",
      rows: countries,
      renderIcon: (r) => <CountryIcon row={r} />,
    },
    { key: "cities", label: "Cities", rows: cities },
    { key: "regions", label: "Regions", rows: regions },
    { key: "continents", label: "Continents", rows: continents },
  ];

  const deviceTabs: BarTab[] = [
    {
      key: "devices",
      label: "Devices",
      rows: devices,
      renderIcon: (r) => <DeviceIcon row={r} />,
    },
    { key: "browsers", label: "Browsers", rows: browsers },
    { key: "os", label: "OS", rows: oses },
  ];

  return (
    <DashboardShell user={user}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
            {focus ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-mono">{focus.shortUrl}</span>
              </p>
            ) : null}
          </div>
          {focus ? (
            <Button asChild variant="outline" size="sm">
              <a href={focus.destinationUrl} target="_blank" rel="noopener noreferrer">
                Visit destination
                <ExternalLink className="size-3" />
              </a>
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {focus ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/analytics" prefetch="intent" aria-label="Clear link filter">
                <X className="size-4" />
                {focus.slug}
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <SlidersHorizontal className="size-4" />
              Filter
            </Button>
          )}
          <Button variant="outline" size="sm" disabled>
            <CalendarRange className="size-4" />
            Last 7 days
          </Button>
        </div>

        {!hasLinks ? (
          <Card className="px-6 py-8 text-center">
            <p className="text-base font-medium">No links yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a link to start collecting analytics.
            </p>
          </Card>
        ) : (
          <>
            <Card className="gap-0 py-0">
              <div className="border-b px-6 pt-5">
                <ClicksTile total={total} />
              </div>
              <div className="px-4 pb-4 pt-6 sm:px-6">
                <HourlyChart data={hourly} />
              </div>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <TabbedBarCard tabs={linksTabs} tone="amber" />
              <TabbedBarCard tabs={referrerTabs} tone="rose" />
              <TabbedBarCard tabs={locationTabs} tone="blue" />
              <TabbedBarCard tabs={deviceTabs} tone="emerald" />
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
