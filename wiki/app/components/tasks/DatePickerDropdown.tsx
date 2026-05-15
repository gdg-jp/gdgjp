import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { formatDueDate } from "./task-utils";

interface DatePickerDropdownProps {
  value: string | null;
  onChange: (date: string | null) => void;
}

function buildCalendarGrid(year: number, month: number): (string | null)[][] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

interface MenuPosition {
  top: number;
  left: number;
}

export default function DatePickerDropdown({ value, onChange }: DatePickerDropdownProps) {
  const { t, i18n } = useTranslation();
  const today = new Date();

  const initDate = value ? new Date(`${value}T00:00:00`) : today;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const savedFocusRef = useRef<Element | null>(null);

  // Sync view to new value when it changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(`${value}T00:00:00`);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  function openPicker(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    savedFocusRef.current = document.activeElement;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
    }
    setOpen(true);
  }

  // Focus management: move focus into dialog when opened, restore when closed
  useEffect(() => {
    if (open) {
      menuRef.current?.focus();
    } else {
      if (savedFocusRef.current instanceof HTMLElement) {
        savedFocusRef.current.focus();
      }
      savedFocusRef.current = null;
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Reposition on scroll
  useEffect(() => {
    if (!open) return;
    function handleScroll() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const weeks = buildCalendarGrid(viewYear, viewMonth);
  const monthLabel = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
  }).format(new Date(viewYear, viewMonth, 1));

  const dayLabels = t("tasks.calendar_days_short", { returnObjects: true }) as string[];

  // Flatten weeks and assign stable keys based on position
  const flatCells = weeks.flat();

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            aria-label={t("tasks.calendar_label")}
            tabIndex={-1}
            style={{ position: "absolute", top: pos.top, left: pos.left }}
            className="z-[9999] w-[252px] rounded-md border border-gray-200 bg-white p-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={prevMonth}
                className="rounded p-0.5 hover:bg-gray-100"
                aria-label={t("tasks.calendar_prev_month")}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-medium text-gray-700">{monthLabel}</span>
              <button
                type="button"
                onClick={nextMonth}
                className="rounded p-0.5 hover:bg-gray-100"
                aria-label={t("tasks.calendar_next_month")}
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="mb-1 grid grid-cols-7">
              {dayLabels.map((d) => (
                <div key={d} className="text-center text-[11px] font-medium text-gray-400">
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {flatCells.map((cell, i) => {
                const key = cell ?? `empty-${i}`;
                if (!cell) return <div key={key} />;
                const isSelected = cell === value;
                const isToday = cell === todayStr;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      onChange(cell);
                      setOpen(false);
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
                      isSelected
                        ? "bg-blue-600 text-white"
                        : isToday
                          ? "ring-1 ring-blue-300 hover:bg-blue-50"
                          : "text-gray-700 hover:bg-blue-50"
                    }`}
                  >
                    {Number.parseInt(cell.split("-")[2], 10)}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-2 border-t border-gray-100 pt-2">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                {t("tasks.calendar_clear")}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded px-1.5 py-0.5 text-sm hover:bg-gray-100"
        onClick={openPicker}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {value ? (
          <span className="text-gray-700">{formatDueDate(value)}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </button>
      {menu}
    </div>
  );
}
