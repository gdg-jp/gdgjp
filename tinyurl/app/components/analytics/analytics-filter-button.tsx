import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Flag,
  Globe,
  Laptop,
  Link as LinkIcon,
  MapPin,
  Map as MapSquare,
  MonitorSmartphone,
  Radio,
  SlidersHorizontal,
  Sparkles,
  Tag as TagIcon,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "~/components/ui/sheet";
import type { TopBlob } from "~/lib/analytics-engine";
import {
  type DimensionFilters,
  FILTER_DIMENSIONS,
  isValidDimensionValue,
  serializeAnalyticsParams,
} from "~/lib/analytics-filters";
import { useMediaQuery } from "~/lib/use-media-query";
import { cn } from "~/lib/utils";

export type FilterSuggestions = Partial<Record<TopBlob, string[]>>;

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

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

const DIMENSION_ICONS: Record<TopBlob, IconType> = {
  slug: LinkIcon,
  country: Flag,
  city: Building2,
  region: MapPin,
  continent: MapSquare,
  browser: Globe,
  os: Laptop,
  device: MonitorSmartphone,
  referer: TagIcon,
  source: Radio,
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
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
    >
      <SlidersHorizontal className="size-4" />
      Filter
      {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
    </button>
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
        <SheetTitle className="sr-only">Filter</SheetTitle>
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
          <kbd className="inline-flex size-5 items-center justify-center rounded border bg-background text-[10px] font-medium text-muted-foreground">
            F
          </kbd>
        ) : null}
      </div>
      <ul className="overflow-y-auto p-1 pb-[env(safe-area-inset-bottom)]">
        <li>
          <button
            type="button"
            disabled
            aria-disabled
            className="flex w-full items-center gap-3 rounded-sm bg-accent/60 px-3 py-2.5 text-left text-sm text-muted-foreground sm:gap-2 sm:px-2 sm:py-1.5"
          >
            <Sparkles className="size-4" />
            Ask AI
          </button>
        </li>
        <li className="my-1 -mx-1 h-px bg-border" />
        {dims.map((d) => {
          const Icon = DIMENSION_ICONS[d];
          return (
            <li key={d}>
              <button
                type="button"
                onClick={() => onPick(d)}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm hover:bg-accent hover:text-accent-foreground sm:gap-2 sm:px-2 sm:py-1.5"
              >
                <Icon className="size-4 text-muted-foreground" />
                {DIMENSION_LABELS[d]}
              </button>
            </li>
          );
        })}
        {dims.length === 0 ? (
          <li className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</li>
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
  const Icon = DIMENSION_ICONS[dim];

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
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:size-6"
        >
          <ChevronLeft className="size-4" />
        </button>
        <Icon className="size-4 text-muted-foreground" />
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
          <li className="px-2 py-3 text-center text-xs text-muted-foreground">No values</li>
        ) : null}
        {filtered.map((v) => {
          const checked = selected.includes(v);
          return (
            <li key={v}>
              <button
                type="button"
                onClick={() => onToggle(v)}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm hover:bg-accent hover:text-accent-foreground sm:gap-2 sm:px-2 sm:py-1.5"
              >
                <span
                  className={cn(
                    "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border",
                    checked && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {checked ? "✓" : null}
                </span>
                <span className="truncate">{v}</span>
              </button>
            </li>
          );
        })}
        {customValid ? (
          <li>
            <button
              type="button"
              onClick={() => {
                onToggle(query.trim());
                setQuery("");
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:gap-2 sm:px-2 sm:py-1.5"
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border" />
              Add "{query.trim()}"
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
