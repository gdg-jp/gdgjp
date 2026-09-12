import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}
function sameDay(a, b) {
  return !!a && !!b && a.toDateString() === b.toDateString();
}
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function selectionMonth(selection) {
  if (selection instanceof Date) return selection;
  if (Array.isArray(selection)) return selection[0];
  return selection?.from;
}
function isRange(selection) {
  return !!selection && !(selection instanceof Date) && !Array.isArray(selection);
}
function compareDays(a, b) {
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
}) {
  const initialMonth = selectionMonth(selected ?? defaultSelected) ?? defaultMonth ?? new Date();
  const [internalMonth, setInternalMonth] = useState(() => startOfMonth(initialMonth));
  const [internalSelected, setInternalSelected] = useState(defaultSelected);
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
  const changeMonth = (delta) => {
    const next = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + delta, 1, 12);
    if (month === undefined) setInternalMonth(next);
    onMonthChange?.(next);
  };
  const isDisabled = (date) =>
    (typeof disabled === "function" && disabled(date)) ||
    (Array.isArray(disabled) && disabled.some((item) => sameDay(item, date))) ||
    (minDate !== undefined && compareDays(date, minDate) < 0) ||
    (maxDate !== undefined && compareDays(date, maxDate) > 0);
  const isSelected = (date) => {
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
  const selectDate = (date) => {
    if (isDisabled(date)) return;
    let next;
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
  const focusDate = (date) => {
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
  const handleDayKeyDown = (event, date) => {
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
  return _jsxs("div", {
    ...props,
    className: cn("gdg-calendar", className),
    children: [
      _jsxs("div", {
        className: "gdg-calendar-header",
        children: [
          _jsx("button", {
            type: "button",
            className: "gdg-calendar-nav",
            onClick: () => changeMonth(-1),
            "aria-label": "\u524D\u306E\u6708",
            children: _jsx(ChevronLeft, { size: 18, "aria-hidden": "true" }),
          }),
          _jsx("strong", { "aria-live": "polite", children: monthLabel }),
          _jsx("button", {
            type: "button",
            className: "gdg-calendar-nav",
            onClick: () => changeMonth(1),
            "aria-label": "\u6B21\u306E\u6708",
            children: _jsx(ChevronRight, { size: 18, "aria-hidden": "true" }),
          }),
        ],
      }),
      _jsxs("table", {
        className: "gdg-calendar-grid",
        "aria-label": monthLabel,
        children: [
          _jsx("thead", {
            children: _jsx("tr", {
              children: orderedWeekdays.map((day) =>
                _jsx("th", { scope: "col", children: day }, day),
              ),
            }),
          }),
          _jsx("tbody", {
            children: Array.from({ length: rowCount }, (_, row) => {
              const week = days.slice(row * 7, row * 7 + 7);
              return _jsx(
                "tr",
                {
                  children: week.map((date) => {
                    const outside = date.getMonth() !== displayedMonth.getMonth();
                    const unavailable = isDisabled(date);
                    const selectedDay = isSelected(date);
                    return _jsx(
                      "td",
                      {
                        children:
                          outside && !showOutsideDays
                            ? _jsx("span", { "aria-hidden": "true" })
                            : _jsx("button", {
                                id: `gdg-calendar-day-${dateKey(date)}`,
                                type: "button",
                                "data-date": dateKey(date),
                                "data-outside": outside || undefined,
                                className: "gdg-calendar-day",
                                disabled: unavailable,
                                "aria-label": date.toLocaleDateString(locale, {
                                  year: "numeric",
                                  month: "long",
                                  day: "numeric",
                                }),
                                "aria-pressed": selectedDay,
                                onClick: () => selectDate(date),
                                onKeyDown: (event) => handleDayKeyDown(event, date),
                                children: date.getDate(),
                              }),
                      },
                      dateKey(date),
                    );
                  }),
                },
                dateKey(week[0] ?? displayedMonth),
              );
            }),
          }),
        ],
      }),
    ],
  });
}
