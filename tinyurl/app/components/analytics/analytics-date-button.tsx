import { CalendarRange, ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useNavigation, useSearchParams } from "react-router";
import { Calendar, type DateRange, fromIsoDate, toIsoDate } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "~/components/ui/sheet";
import {
  PERIOD_HOTKEYS,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodPreset,
  parseAnalyticsParams,
  serializeAnalyticsParams,
} from "~/lib/analytics-filters";
import { useMediaQuery } from "~/lib/use-media-query";
import { cn } from "~/lib/utils";

type Props = {
  preset: PeriodPreset;
  startIso?: string;
  endIso?: string;
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

export function AnalyticsDateButton({ preset, startIso, endIso }: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = useState(false);

  // Show the pending preset/range during navigation so the trigger label updates
  // instantly on click, not after the loader finishes.
  const display = useMemo(() => {
    if (navigation.state !== "idle" && navigation.location) {
      const params = new URLSearchParams(navigation.location.search);
      const parsed = parseAnalyticsParams(params);
      return {
        preset: parsed.preset,
        startIso: parsed.window.kind === "custom" ? parsed.window.startIso : undefined,
        endIso: parsed.window.kind === "custom" ? parsed.window.endIso : undefined,
      };
    }
    return { preset, startIso, endIso };
  }, [navigation.state, navigation.location, preset, startIso, endIso]);

  const initialRange = useMemo<DateRange | null>(() => {
    if (preset === "custom" && startIso && endIso) {
      return { start: fromIsoDate(startIso), end: fromIsoDate(endIso) };
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
    const params = serializeAnalyticsParams(searchParams, { preset: next });
    setOpen(false);
    navigate(`?${params.toString()}`, { preventScrollReset: true });
  }

  function handleRangeChange(next: DateRange) {
    setRange(next);
    if (next.start && next.end) {
      const params = serializeAnalyticsParams(searchParams, {
        preset: "custom",
        startIso: toIsoDate(next.start),
        endIso: toIsoDate(next.end),
      });
      setOpen(false);
      navigate(`?${params.toString()}`, { preventScrollReset: true });
    }
  }

  const trigger: ReactNode = (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition hover:bg-accent hover:text-accent-foreground"
    >
      <CalendarRange className="size-4" />
      {label}
      {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
    </button>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="flex w-auto gap-0 p-0">
          <div className="border-r p-2">
            <Calendar value={range} onChange={handleRangeChange} numberOfMonths={2} />
          </div>
          <ul className="flex w-56 flex-col gap-0.5 p-2">
            {PERIOD_PRESETS.map((p) => {
              const active = display.preset === p;
              return (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <span>{PERIOD_LABELS[p]}</span>
                    <kbd className="inline-flex size-5 items-center justify-center rounded border bg-background text-[10px] font-medium text-muted-foreground">
                      {PERIOD_HOTKEYS[p]}
                    </kbd>
                  </button>
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
        <SheetTitle className="sr-only">Date range</SheetTitle>
        <div className="overflow-x-auto border-b">
          <ul className="flex w-max gap-2 px-3 py-3">
            {PERIOD_PRESETS.map((p) => {
              const active = display.preset === p;
              return (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={cn(
                      "inline-flex h-9 items-center whitespace-nowrap rounded-md border px-3 text-sm transition",
                      active
                        ? "border-foreground bg-background font-medium text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="overflow-y-auto px-2 pb-[env(safe-area-inset-bottom)]">
          <Calendar value={range} onChange={handleRangeChange} numberOfMonths={1} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
