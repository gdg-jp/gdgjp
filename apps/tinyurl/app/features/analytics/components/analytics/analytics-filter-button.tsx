import {
  Button,
  Checkbox,
  type IconName,
  Icons,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  cn,
} from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { TopBlob } from "~/features/analytics/analytics-engine";
import {
  type DimensionFilters,
  FILTER_DIMENSIONS,
  isValidDimensionValue,
  serializeAnalyticsParams,
} from "~/features/analytics/analytics-filters";
import { useMediaQuery } from "~/lib/use-media-query";
export type FilterSuggestions = Partial<Record<TopBlob, string[]>>;

const DIMENSION_LABELS: Record<TopBlob, string> = {
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

const DIMENSION_ICONS: Record<TopBlob, IconName> = {
  slug: "Link",
  country: "MapPin",
  city: "Home",
  region: "MapPin",
  continent: "MapPin",
  browser: "Globe",
  os: "MonitorCheck",
  device: "MonitorCheck",
  referer: "Tag",
  source: "Radio",
};

type Props = {
  filters: DimensionFilters;
  suggestions: FilterSuggestions;
};

export function AnalyticsFilterButton({ filters, suggestions }: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = useState(false);
  const [pickedDim, setPickedDim] = useState<TopBlob | null>(null);
  const [query, setQuery] = useState("");

  function commitFilters(next: DimensionFilters) {
    const params = serializeAnalyticsParams(searchParams, { filters: next });
    navigate(`?${params.toString()}`, { preventScrollReset: true });
  }

  function toggleValue(dim: TopBlob, value: string) {
    const current = filters[dim] ?? [];
    const exists = current.includes(value);
    const nextValues = exists ? current.filter((v) => v !== value) : [...current, value];
    const next: DimensionFilters = { ...filters };
    if (nextValues.length === 0) delete next[dim];
    else next[dim] = nextValues;
    commitFilters(next);
  }

  const filteredDims = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FILTER_DIMENSIONS;
    return FILTER_DIMENSIONS.filter((d) => DIMENSION_LABELS[d].toLowerCase().includes(q));
  }, [query]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPickedDim(null);
      setQuery("");
    }
  }

  const trigger: ReactNode = (
    <Button
      variant="ghost"
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition hover:bg-selected hover:text-foreground"
    >
      <Icons name="SlidersHorizontal" aria-hidden="true" className="size-4" />
      Filter
      {open ? (
        <Icons name="ChevronUp" aria-hidden="true" className="size-4" />
      ) : (
        <Icons name="ChevronDown" aria-hidden="true" className="size-4" />
      )}
    </Button>
  );

  const body: ReactNode =
    pickedDim === null ? (
      <DimensionList
        query={query}
        setQuery={setQuery}
        dims={filteredDims}
        onPick={setPickedDim}
        showKbd={isDesktop}
      />
    ) : (
      <ValuePicker
        dim={pickedDim}
        selected={filters[pickedDim] ?? []}
        suggestions={suggestions[pickedDim] ?? []}
        onBack={() => setPickedDim(null)}
        onToggle={(v) => toggleValue(pickedDim, v)}
      />
    );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetTitle>Filter</SheetTitle>
        <SheetDescription>Choose the dimensions and values to include.</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function DimensionList({
  query,
  setQuery,
  dims,
  onPick,
  showKbd,
}: {
  query: string;
  setQuery: (v: string) => void;
  dims: readonly TopBlob[];
  onPick: (d: TopBlob) => void;
  showKbd: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 sm:py-2">
        <Input
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
        />
        {showKbd ? (
          <kbd className="inline-flex size-5 items-center justify-center rounded border bg-background text-[10px] font-medium text-muted">
            F
          </kbd>
        ) : null}
      </div>
      <ul className="overflow-y-auto p-1 pb-[env(safe-area-inset-bottom)]">
        <li>
          <Button
            fullWidth
            variant="ghost"
            type="button"
            disabled
            aria-disabled
            className="flex  items-center gap-3 rounded-sm bg-selected/60 px-3 py-2.5 text-left text-sm text-muted sm:gap-2 sm:px-2 sm:py-1.5"
          >
            <Icons name="Sparkles" aria-hidden="true" className="size-4" />
            Ask AI
          </Button>
        </li>
        <li className="my-1 -mx-1 h-px bg-border" />
        {dims.map((d) => {
          const icon = DIMENSION_ICONS[d];
          return (
            <li key={d}>
              <Button
                fullWidth
                variant="ghost"
                type="button"
                onClick={() => onPick(d)}
                className="flex  items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm hover:bg-selected hover:text-foreground sm:gap-2 sm:px-2 sm:py-1.5"
              >
                <Icons name={icon} aria-hidden="true" className="size-4 text-muted" />
                {DIMENSION_LABELS[d]}
              </Button>
            </li>
          );
        })}
        {dims.length === 0 ? (
          <li className="px-2 py-3 text-center text-xs text-muted">No matches</li>
        ) : null}
      </ul>
    </div>
  );
}

function ValuePicker({
  dim,
  selected,
  suggestions,
  onBack,
  onToggle,
}: {
  dim: TopBlob;
  selected: readonly string[];
  suggestions: readonly string[];
  onBack: () => void;
  onToggle: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const icon = DIMENSION_ICONS[dim];

  const merged = useMemo(() => {
    const set = new Set<string>(suggestions);
    for (const v of selected) set.add(v);
    return Array.from(set);
  }, [suggestions, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((v) => v.toLowerCase().includes(q));
  }, [merged, query]);

  const customValid =
    query.trim().length > 0 &&
    !merged.includes(query.trim()) &&
    isValidDimensionValue(dim, query.trim());

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-2">
        <Button
          variant="ghost"
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="inline-flex size-7 items-center justify-center rounded-sm text-muted hover:bg-selected hover:text-foreground sm:size-6"
        >
          <Icons name="ChevronLeft" aria-hidden="true" className="size-4" />
        </Button>
        <Icons name={icon} aria-hidden="true" className="size-4 text-muted" />
        <span className="text-sm font-medium">{DIMENSION_LABELS[dim]}</span>
      </div>
      <div className="border-b px-3 py-2">
        <Input
          placeholder={`Filter ${DIMENSION_LABELS[dim].toLowerCase()}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <ul className="max-h-[60vh] overflow-y-auto p-1 pb-[env(safe-area-inset-bottom)] sm:max-h-64">
        {filtered.length === 0 && !customValid ? (
          <li className="px-2 py-3 text-center text-xs text-muted">No values</li>
        ) : null}
        {filtered.map((v) => {
          const checked = selected.includes(v);
          return (
            <li key={v}>
              <Label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-selected">
                <Checkbox checked={checked} onCheckedChange={() => onToggle(v)} />
                <span className="truncate">{v}</span>
              </Label>
            </li>
          );
        })}
        {customValid ? (
          <li>
            <Button
              fullWidth
              variant="ghost"
              type="button"
              onClick={() => {
                onToggle(query.trim());
                setQuery("");
              }}
              className="flex  items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm text-muted hover:bg-selected hover:text-foreground sm:gap-2 sm:px-2 sm:py-1.5"
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border" />
              Add "{query.trim()}"
            </Button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
