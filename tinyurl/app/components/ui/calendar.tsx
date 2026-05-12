"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";

export type DateRange = { start: Date; end: Date | null };

type CalendarProps = {
  value: DateRange | null;
  onChange: (range: DateRange) => void;
  initialMonth?: Date;
  numberOfMonths?: number;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isBetween(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime();
  return t > start.getTime() && t < end.getTime();
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = first.getDay(); // 0 = Sunday
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function MonthView({
  year,
  month,
  value,
  hovered,
  onPick,
  onHover,
  onPrev,
  onNext,
  showPrev,
  showNext,
}: {
  year: number;
  month: number;
  value: DateRange | null;
  hovered: Date | null;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
  onPrev?: () => void;
  onNext?: () => void;
  showPrev: boolean;
  showNext: boolean;
}) {
  const cells = buildMonthGrid(year, month);
  const start = value?.start ?? null;
  const end = value?.end ?? null;
  // Live preview range for in-progress selection (start picked, hovering toward end)
  const liveEnd = end ?? hovered;
  const previewStart =
    start && liveEnd ? (start.getTime() <= liveEnd.getTime() ? start : liveEnd) : start;
  const previewEnd =
    start && liveEnd ? (start.getTime() <= liveEnd.getTime() ? liveEnd : start) : null;

  return (
    <div className="w-full sm:w-[280px]">
      <div className="mb-3 flex items-center justify-between px-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={onPrev}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-accent hover:text-foreground",
            !showPrev && "invisible",
          )}
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="text-sm font-medium">
          {MONTH_NAMES[month]} {year}
        </div>
        <button
          type="button"
          aria-label="Next month"
          onClick={onNext}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-accent hover:text-foreground",
            !showNext && "invisible",
          )}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
        {cells.map((d, i) => {
          if (!d) {
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per grid
            return <div key={`b${i}`} />;
          }
          const isStart = previewStart && isSameDay(d, previewStart);
          const isEnd = previewEnd && isSameDay(d, previewEnd);
          const isInRange = previewStart && previewEnd && isBetween(d, previewStart, previewEnd);
          const isEdge = isStart || isEnd;
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              onMouseLeave={() => onHover(null)}
              className={cn(
                "mx-auto flex aspect-square w-full max-w-12 items-center justify-center rounded-md text-sm tabular-nums transition sm:size-9 sm:max-w-none",
                !isEdge && !isInRange && "hover:bg-accent",
                isInRange && "rounded-none bg-primary/10 text-foreground",
                isStart && "rounded-md bg-primary text-primary-foreground underline",
                isEnd && "rounded-md bg-primary text-primary-foreground underline",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Calendar({ value, onChange, initialMonth, numberOfMonths = 2 }: CalendarProps) {
  const [anchor, setAnchor] = useState<Date>(() => {
    const base = initialMonth ?? value?.start ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [hovered, setHovered] = useState<Date | null>(null);

  function handlePick(d: Date) {
    const day = startOfDay(d);
    // If no start, or both start & end set → begin a fresh range
    if (!value || (value.start && value.end)) {
      onChange({ start: day, end: null });
      return;
    }
    // Have start, no end: complete the range (swap if user picked an earlier date)
    const start = value.start;
    if (day.getTime() < start.getTime()) {
      onChange({ start: day, end: start });
    } else {
      onChange({ start, end: day });
    }
  }

  return (
    <div className="flex gap-6 p-2">
      {Array.from({ length: numberOfMonths }).map((_, i) => {
        const m = addMonths(anchor, i);
        return (
          <MonthView
            // biome-ignore lint/suspicious/noArrayIndexKey: stable index per render
            key={i}
            year={m.getFullYear()}
            month={m.getMonth()}
            value={value}
            hovered={hovered}
            onPick={handlePick}
            onHover={setHovered}
            showPrev={i === 0}
            showNext={i === numberOfMonths - 1}
            onPrev={i === 0 ? () => setAnchor(addMonths(anchor, -1)) : undefined}
            onNext={i === numberOfMonths - 1 ? () => setAnchor(addMonths(anchor, 1)) : undefined}
          />
        );
      })}
    </div>
  );
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d);
}
