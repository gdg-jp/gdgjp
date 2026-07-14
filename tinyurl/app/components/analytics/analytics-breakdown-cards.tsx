import { Globe, Laptop, Link as LinkIcon, Smartphone, Tablet } from "lucide-react";
import { type ReactNode, forwardRef } from "react";
import { BarList, type BarListRow } from "~/components/charts/bar-list";
import { type BarTab, TabbedBarCard } from "~/components/charts/tabbed-bar-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import type { TopBlob, TopRow } from "~/lib/analytics-engine";

type DimensionRows = {
  referrers: TopRow[];
  countries: TopRow[];
  cities: TopRow[];
  regions: TopRow[];
  continents: TopRow[];
  devices: TopRow[];
  browsers: TopRow[];
  oses: TopRow[];
};

type Dimension = Extract<
  TopBlob,
  "referer" | "country" | "city" | "region" | "continent" | "device" | "browser" | "os"
>;

export const AnalyticsClicksChartCard = forwardRef<
  HTMLDivElement,
  { total: number; pending?: boolean; children: ReactNode }
>(function AnalyticsClicksChartCard({ total, pending = false, children }, ref) {
  return (
    <Card ref={ref} className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-end justify-between gap-4">
          <span className="text-sm font-medium text-muted-foreground">Clicks</span>
          {pending ? (
            <Skeleton className="h-9 w-20" />
          ) : (
            <span className="text-3xl font-semibold tabular-nums">{total.toLocaleString()}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 px-3 sm:px-6">{children}</CardContent>
    </Card>
  );
});

type AnalyticsBarListCardProps = {
  title: string;
  description?: ReactNode;
  rows: BarListRow[];
  emptyLabel?: string;
  height?: number;
  pending?: boolean;
  loading?: boolean;
  loadingContent?: ReactNode;
  selectedKey?: string;
  onSelect?: (row: BarListRow) => void;
};

export function AnalyticsBarListCard({
  title,
  description,
  rows,
  emptyLabel,
  height = 260,
  pending,
  loading,
  loadingContent,
  selectedKey,
  onSelect,
}: AnalyticsBarListCardProps) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-1">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="min-w-0 px-4 sm:px-6">
        {loading ? (
          loadingContent
        ) : (
          <BarList
            rows={rows}
            emptyLabel={emptyLabel}
            height={height}
            pending={pending}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsBarListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading analytics data">
      {["first", "second", "third", "fourth", "fifth"].map((key) => (
        <Skeleton key={key} className="h-7 w-full" />
      ))}
    </div>
  );
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
  const name = row.name.toLowerCase();
  if (name.includes("mobile") || name.includes("phone")) {
    return <Smartphone className="size-4 text-muted-foreground" />;
  }
  if (name.includes("tablet")) {
    return <Tablet className="size-4 text-muted-foreground" />;
  }
  return <Laptop className="size-4 text-muted-foreground" />;
}

function AnalyticsTabbedBarCardSkeleton() {
  return (
    <Card className="gap-0 py-0" aria-hidden>
      <div className="flex items-center justify-between gap-3 border-b px-5 pt-4">
        <div className="flex items-center gap-3 pb-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="mb-3 h-3 w-10" />
      </div>
      <div className="space-y-3 px-5 py-4" style={{ minHeight: 272 }}>
        {["first", "second", "third", "fourth", "fifth"].map((key, index) => (
          <Skeleton key={key} className="h-6" style={{ width: `${90 - index * 12}%` }} />
        ))}
      </div>
    </Card>
  );
}

export function AnalyticsDimensionCards({
  analytics,
  loading = false,
  pending = false,
  selected = {},
  onSelect,
}: {
  analytics: DimensionRows;
  loading?: boolean;
  pending?: boolean;
  selected?: Partial<Record<Dimension, string[]>>;
  onSelect?: (dimension: Dimension, row: TopRow) => void;
}) {
  const referrerTabs: BarTab[] = [
    {
      key: "campaign-referrers",
      label: "Referrers",
      rows: analytics.referrers,
      emptyLabel: "No referrers yet.",
      renderIcon: (row) => <ReferrerIcon row={row} />,
      pending,
      selectedKey: selected.referer?.length === 1 ? selected.referer[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("referer", row) : undefined,
    },
  ];
  const locationTabs: BarTab[] = [
    {
      key: "campaign-countries",
      label: "Countries",
      rows: analytics.countries,
      renderIcon: (row) => <CountryIcon row={row} />,
      pending,
      selectedKey: selected.country?.length === 1 ? selected.country[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("country", row) : undefined,
    },
    {
      key: "campaign-cities",
      label: "Cities",
      rows: analytics.cities,
      pending,
      selectedKey: selected.city?.length === 1 ? selected.city[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("city", row) : undefined,
    },
    {
      key: "campaign-regions",
      label: "Regions",
      rows: analytics.regions,
      pending,
      selectedKey: selected.region?.length === 1 ? selected.region[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("region", row) : undefined,
    },
    {
      key: "campaign-continents",
      label: "Continents",
      rows: analytics.continents,
      pending,
      selectedKey: selected.continent?.length === 1 ? selected.continent[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("continent", row) : undefined,
    },
  ];
  const deviceTabs: BarTab[] = [
    {
      key: "campaign-devices",
      label: "Devices",
      rows: analytics.devices,
      renderIcon: (row) => <DeviceIcon row={row} />,
      pending,
      selectedKey: selected.device?.length === 1 ? selected.device[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("device", row) : undefined,
    },
    {
      key: "campaign-browsers",
      label: "Browsers",
      rows: analytics.browsers,
      pending,
      selectedKey: selected.browser?.length === 1 ? selected.browser[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("browser", row) : undefined,
    },
    {
      key: "campaign-os",
      label: "OS",
      rows: analytics.oses,
      pending,
      selectedKey: selected.os?.length === 1 ? selected.os[0] : undefined,
      onSelect: onSelect ? (row) => onSelect("os", row) : undefined,
    },
  ];

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {loading ? (
        <>
          <AnalyticsTabbedBarCardSkeleton />
          <AnalyticsTabbedBarCardSkeleton />
          <AnalyticsTabbedBarCardSkeleton />
        </>
      ) : (
        <>
          <TabbedBarCard tabs={referrerTabs} tone="rose" />
          <TabbedBarCard tabs={locationTabs} tone="blue" />
          <TabbedBarCard tabs={deviceTabs} tone="emerald" />
        </>
      )}
    </div>
  );
}
