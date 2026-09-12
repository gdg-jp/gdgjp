import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, useMemo, useState } from "react";
import { cn } from "../../utils";

export type DateRange = { from?: Date; to?: Date };
export type CalendarSelection = Date | Date[] | DateRange | undefined;
export type CalendarMode = "single" | "multiple" | "range";

export type CalendarProps = Omit<ComponentProps<"div">, "onSelect"> & {
  mode?: CalendarMode;
  month?: Date;
  defaultMonth?: Date;
  selected?: CalendarSelection;
  defaultSelected?: CalendarSelection;
  onMonthChange?: (month: Date) => void;
  onSelect?: (selection: CalendarSelection) => void;
  disabled?: ((date: Date) => boolean) | Date[];
  minDate?: Date;
  maxDate?: Date;
  showOutsideDays?: boolean;
  locale?: string;
  weekStartsOn?: number;
};

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function sameDay(a: Date | undefined, b: Date | undefined) {
  return !!a && !!b && a.toDateString() === b.toDateString();
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function selectionMonth(selection: CalendarSelection) {
  if (selection instanceof Date) return selection;
  if (Array.isArray(selection)) return selection[0];
  return selection?.from;
}

function isRange(selection: CalendarSelection): selection is DateRange {
  return !!selection && !(selection instanceof Date) && !Array.isArray(selection);
}

function compareDays(a: Date, b: Date) {
  return (
    new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
    new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  );
}

export function Calendar({
  mode = "single",
  month,
  defaultMonth,
  selected,
  defaultSelected,
  onMonthChange,
  onSelect,
  disabled,
  minDate,
  maxDate,
  showOutsideDays = true,
  locale = "ja-JP",
  weekStartsOn = 0,
  className,
  ...props
}: CalendarProps) {
  const initialMonth = selectionMonth(selected ?? defaultSelected) ?? defaultMonth ?? new Date();
  const [internalMonth, setInternalMonth] = useState(() => startOfMonth(initialMonth));
  const [internalSelected, setInternalSelected] = useState<CalendarSelection>(defaultSelected);
  const displayedMonth = startOfMonth(month ?? internalMonth);
  const currentSelection = selected !== undefined ? selected : internalSelected;
  const firstWeekday = displayedMonth.getDay();
  const offset = (firstWeekday - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(
    displayedMonth.getFullYear(),
    displayedMonth.getMonth() + 1,
    0,
  ).getDate();
  const rowCount = Math.ceil((offset + daysInMonth) / 7);
  const days = useMemo(() => {
    const first = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), 1 - offset, 12);
    return Array.from({ length: rowCount * 7 }, (_, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      return date;
    });
  }, [displayedMonth, offset, rowCount]);

  const changeMonth = (delta: number) => {
    const next = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + delta, 1, 12);
    if (month === undefined) setInternalMonth(next);
    onMonthChange?.(next);
  };

  const isDisabled = (date: Date) =>
    (typeof disabled === "function" && disabled(date)) ||
    (Array.isArray(disabled) && disabled.some((item) => sameDay(item, date))) ||
    (minDate !== undefined && compareDays(date, minDate) < 0) ||
    (maxDate !== undefined && compareDays(date, maxDate) > 0);

  const isSelected = (date: Date) => {
    if (currentSelection instanceof Date) return sameDay(currentSelection, date);
    if (Array.isArray(currentSelection))
      return currentSelection.some((item) => sameDay(item, date));
    if (isRange(currentSelection)) {
      return (
        sameDay(currentSelection.from, date) ||
        sameDay(currentSelection.to, date) ||
        (!!currentSelection.from &&
          !!currentSelection.to &&
          compareDays(date, currentSelection.from) > 0 &&
          compareDays(date, currentSelection.to) < 0)
      );
    }
    return false;
  };

  const selectDate = (date: Date) => {
    if (isDisabled(date)) return;
    let next: CalendarSelection;
    if (mode === "multiple") {
      const items = Array.isArray(currentSelection) ? currentSelection : [];
      next = items.some((item) => sameDay(item, date))
        ? items.filter((item) => !sameDay(item, date))
        : [...items, date];
    } else if (mode === "range") {
      const range = isRange(currentSelection) ? currentSelection : {};
      next =
        !range.from || range.to
          ? { from: date }
          : compareDays(date, range.from) < 0
            ? { from: date, to: range.from }
            : { from: range.from, to: date };
    } else {
      next = date;
    }
    if (selected === undefined) setInternalSelected(next);
    onSelect?.(next);
  };

  const focusDate = (date: Date) => {
    if (
      date.getMonth() !== displayedMonth.getMonth() ||
      date.getFullYear() !== displayedMonth.getFullYear()
    ) {
      const next = startOfMonth(date);
      if (month === undefined) setInternalMonth(next);
      onMonthChange?.(next);
    }
    window.requestAnimationFrame(() =>
      document.getElementById(`gdg-calendar-day-${dateKey(date)}`)?.focus(),
    );
  };

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const movement =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -7
            : event.key === "ArrowDown"
              ? 7
              : 0;
    if (!movement) return;
    event.preventDefault();
    const next = new Date(date);
    next.setDate(date.getDate() + movement);
    focusDate(next);
  };

  const monthLabel = displayedMonth.toLocaleDateString(locale, { year: "numeric", month: "long" });
  const orderedWeekdays = weekdayLabels
    .slice(weekStartsOn)
    .concat(weekdayLabels.slice(0, weekStartsOn));

  return (
    <div {...props} className={cn("gdg-calendar", className)}>
      <div className="gdg-calendar-header">
        <button
          type="button"
          className="gdg-calendar-nav"
          onClick={() => changeMonth(-1)}
          aria-label="前の月"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <strong aria-live="polite">{monthLabel}</strong>
        <button
          type="button"
          className="gdg-calendar-nav"
          onClick={() => changeMonth(1)}
          aria-label="次の月"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <table className="gdg-calendar-grid" aria-label={monthLabel}>
        <thead>
          <tr>
            {orderedWeekdays.map((day) => (
              <th key={day} scope="col">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, row) => {
            const week = days.slice(row * 7, row * 7 + 7);
            return (
              <tr key={dateKey(week[0] ?? displayedMonth)}>
                {week.map((date) => {
                  const outside = date.getMonth() !== displayedMonth.getMonth();
                  const unavailable = isDisabled(date);
                  const selectedDay = isSelected(date);
                  return (
                    <td key={dateKey(date)}>
                      {outside && !showOutsideDays ? (
                        <span aria-hidden="true" />
                      ) : (
                        <button
                          id={`gdg-calendar-day-${dateKey(date)}`}
                          type="button"
                          data-date={dateKey(date)}
                          data-outside={outside || undefined}
                          className="gdg-calendar-day"
                          disabled={unavailable}
                          aria-label={date.toLocaleDateString(locale, {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                          aria-pressed={selectedDay}
                          onClick={() => selectDate(date)}
                          onKeyDown={(event) => handleDayKeyDown(event, date)}
                        >
                          {date.getDate()}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
