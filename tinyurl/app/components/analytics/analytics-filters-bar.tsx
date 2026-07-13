import { X } from "lucide-react";
import { useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import type { TopBlob } from "~/lib/analytics-engine";
import {
  type DimensionFilters,
  FILTER_DIMENSIONS,
  type PeriodPreset,
  serializeAnalyticsParams,
} from "~/lib/analytics-filters";
import { AnalyticsDateButton } from "./analytics-date-button";
import { AnalyticsFilterButton, type FilterSuggestions } from "./analytics-filter-button";

const DIMENSION_CHIP_LABELS: Record<TopBlob, string> = {
  slug: "Link",
  country: "Country",
  city: "City",
  region: "Region",
  continent: "Continent",
  browser: "Browser",
  os: "OS",
  device: "Device",
  referer: "Referrer",
  source: "Source",
};

type Props = {
  preset: PeriodPreset;
  startIso?: string;
  endIso?: string;
  filters: DimensionFilters;
  suggestions: FilterSuggestions;
};

export function AnalyticsFiltersBar({ preset, startIso, endIso, filters, suggestions }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  function removeValue(dim: TopBlob, value: string) {
    const next: DimensionFilters = { ...filters };
    const remaining = (next[dim] ?? []).filter((v) => v !== value);
    if (remaining.length === 0) delete next[dim];
    else next[dim] = remaining;
    const params = serializeAnalyticsParams(searchParams, { filters: next });
    setSearchParams(params, { preventScrollReset: true });
  }

  const chips: Array<{ dim: TopBlob; value: string }> = [];
  for (const dim of FILTER_DIMENSIONS) {
    for (const v of filters[dim] ?? []) chips.push({ dim, value: v });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AnalyticsFilterButton filters={filters} suggestions={suggestions} />
      {chips.map(({ dim, value }) => (
        <Button
          key={`${dim}:${value}`}
          variant="outline"
          size="sm"
          onClick={() => removeValue(dim, value)}
          aria-label={`Remove ${DIMENSION_CHIP_LABELS[dim]} filter ${value}`}
        >
          <X className="size-4" />
          <span className="font-normal text-muted-foreground">{DIMENSION_CHIP_LABELS[dim]}:</span>
          {value}
        </Button>
      ))}
      <AnalyticsDateButton preset={preset} startIso={startIso} endIso={endIso} />
    </div>
  );
}
