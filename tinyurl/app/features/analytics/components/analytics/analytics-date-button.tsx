import {
  Button,
  Calendar,
  type CalendarSelection,
  type DateRange,
  Icons,
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
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useNavigation, useSearchParams } from "react-router";
import {
  ANALYTICS_PERIOD_PARAMS,
  PERIOD_HOTKEYS,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodParamNames,
  type PeriodPreset,
  parsePeriodParams,
  serializePeriodParams,
} from "~/features/analytics/analytics-filters";
import { fromIsoDate, toIsoDate } from "~/features/analytics/date-format";
import { useMediaQuery } from "~/lib/use-media-query";
type Props = {
  preset: PeriodPreset;
  startIso?: string;
  endIso?: string;
  params?: PeriodParamNames;
  defaultPreset?: PeriodPreset;
};

function formatCustomLabel(startIso: string, endIso: string): string {
  const start = fromIsoDate(startIso);
  const end = fromIsoDate(endIso);
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (start.getTime() === end.getTime()) return fmt(start, true);
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
}

export function AnalyticsDateButton({
  preset,
  startIso,
  endIso,
  params = ANALYTICS_PERIOD_PARAMS,
  defaultPreset = "7d",
}: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = useState(false);

  // Show the pending preset/range during navigation so the trigger label updates
  // instantly on click, not after the loader finishes.
  const display = useMemo(() => {
    if (navigation.state !== "idle" && navigation.location) {
      const pendingParams = new URLSearchParams(navigation.location.search);
      const parsed = parsePeriodParams(pendingParams, params, defaultPreset);
      return {
        preset: parsed.preset,
        startIso: parsed.window.kind === "custom" ? parsed.window.startIso : undefined,
        endIso: parsed.window.kind === "custom" ? parsed.window.endIso : undefined,
      };
    }
    return { preset, startIso, endIso };
  }, [navigation.state, navigation.location, preset, startIso, endIso, params, defaultPreset]);

  const initialRange = useMemo<DateRange | null>(() => {
    if (preset === "custom" && startIso && endIso) {
      return { from: fromIsoDate(startIso), to: fromIsoDate(endIso) };
    }
    return null;
  }, [preset, startIso, endIso]);

  const [range, setRange] = useState<DateRange | null>(initialRange);

  useEffect(() => {
    setRange(initialRange);
  }, [initialRange]);

  const label =
    display.preset === "custom" && display.startIso && display.endIso
      ? formatCustomLabel(display.startIso, display.endIso)
      : PERIOD_LABELS[display.preset];

  function applyPreset(next: PeriodPreset) {
    const nextParams = serializePeriodParams(searchParams, { preset: next }, params, defaultPreset);
    setOpen(false);
    navigate(`?${nextParams.toString()}`, { preventScrollReset: true });
  }

  function handleRangeChange(selection: CalendarSelection) {
    if (!selection || selection instanceof Date || Array.isArray(selection)) return;
    const next = selection;
    setRange(next);
    if (next.from && next.to) {
      const nextParams = serializePeriodParams(
        searchParams,
        {
          preset: "custom",
          startIso: toIsoDate(next.from),
          endIso: toIsoDate(next.to),
        },
        params,
        defaultPreset,
      );
      setOpen(false);
      navigate(`?${nextParams.toString()}`, { preventScrollReset: true });
    }
  }

  const trigger: ReactNode = (
    <Button variant="outline" size="sm">
      <Icons name="CalendarDays" aria-hidden="true" className="size-4" />
      {label}
      {open ? (
        <Icons name="ChevronUp" aria-hidden="true" className="size-4" />
      ) : (
        <Icons name="ChevronDown" aria-hidden="true" className="size-4" />
      )}
    </Button>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="flex w-auto gap-0 p-0">
          <div className="border-r p-2">
            <Calendar mode="range" selected={range ?? undefined} onSelect={handleRangeChange} />
          </div>
          <ul className="flex w-56 flex-col gap-0.5 p-2">
            {PERIOD_PRESETS.map((p) => {
              const active = display.preset === p;
              return (
                <li key={p}>
                  <Button
                    fullWidth
                    variant="ghost"
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyPreset(p)}
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2 text-sm transition",
                      active
                        ? "bg-selected font-medium text-foreground"
                        : "hover:bg-selected hover:text-foreground",
                    )}
                  >
                    <span>{PERIOD_LABELS[p]}</span>
                    <kbd className="inline-flex size-5 items-center justify-center rounded border bg-background text-[10px] font-medium text-muted">
                      {PERIOD_HOTKEYS[p]}
                    </kbd>
                  </Button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetTitle>Date range</SheetTitle>
        <SheetDescription>Select a preset or a start and end date.</SheetDescription>
        <div className="overflow-x-auto border-b">
          <ul className="flex w-max gap-2 px-3 py-3">
            {PERIOD_PRESETS.map((p) => {
              const active = display.preset === p;
              return (
                <li key={p}>
                  <Button
                    fullWidth
                    variant="ghost"
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyPreset(p)}
                    className={cn(
                      "inline-flex h-9 items-center whitespace-nowrap rounded-md border px-3 text-sm transition",
                      active
                        ? "border-primary bg-selected font-medium text-foreground"
                        : "border-border bg-background text-muted hover:bg-selected hover:text-foreground",
                    )}
                  >
                    {PERIOD_LABELS[p]}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="overflow-y-auto px-2 pb-[env(safe-area-inset-bottom)]">
          <Calendar mode="range" selected={range ?? undefined} onSelect={handleRangeChange} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
