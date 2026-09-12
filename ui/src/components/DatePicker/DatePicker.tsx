import { CalendarDays } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { cn } from "../../utils";
import { Calendar, type CalendarProps } from "../Calendar";
import { Input } from "../Input";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";

export type DatePickerProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange" | "type"
> & {
  value?: Date;
  defaultValue?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  locale?: string;
  calendarProps?: Omit<CalendarProps, "mode" | "selected" | "onSelect">;
};

function sameDay(a: Date | undefined, b: Date | undefined) {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime());
}

function compareDays(a: Date, b: Date) {
  return (
    new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
    new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  );
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

type DateInputState = {
  year: string;
  month: string;
  day: string;
};

function dateInputStateFromValue(value: string): DateInputState {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return {
    year: digits.slice(0, 4),
    month: digits.slice(4, 6),
    day: digits.slice(6, 8),
  };
}

function formatDateInputState(state: DateInputState) {
  if (!state.year) return "";
  if (!state.month) return state.year;

  const month = state.month.padStart(2, "0");
  if (!state.day) return `${state.year}/${month}`;

  return `${state.year}/${month}/${state.day.padStart(2, "0")}`;
}

function appendDateInputDigit(state: DateInputState, digit: string): DateInputState {
  if (state.year.length < 4) return { ...state, year: `${state.year}${digit}` };
  if (!state.month) return { ...state, month: digit };

  // A month starting with 2-9 is complete after one digit (04 is displayed as 04).
  if (state.month.length === 1 && Number(state.month) > 1) {
    return state.day.length < 2 ? { ...state, day: `${state.day}${digit}` } : state;
  }
  if (state.month.length < 2) return { ...state, month: `${state.month}${digit}` };
  if (state.day.length < 2) return { ...state, day: `${state.day}${digit}` };

  return state;
}

function formatDateInputValue(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;

  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6).padStart(2, "0");
  if (digits.length <= 6) return `${year}/${month}`;

  return `${year}/${month}/${digits.slice(6, 8).padStart(2, "0")}`;
}

function parseDateInput(value: string) {
  const compact = value.replace(/\s/g, "");
  const parts = /^\d{8}$/.test(compact)
    ? [compact.slice(0, 4), compact.slice(4, 6), compact.slice(6, 8)]
    : compact
        .replace(/年|月/g, "/")
        .replace(/日$/g, "")
        .replace(/[.-]/g, "/")
        .replace(/\/{2,}/g, "/")
        .replace(/^\/|\/$/g, "")
        .split("/");
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return undefined;

  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

function isDateUnavailable(date: Date, calendarProps: DatePickerProps["calendarProps"]) {
  const disabled = calendarProps?.disabled;
  return (
    (typeof disabled === "function" && disabled(date)) ||
    (Array.isArray(disabled) && disabled.some((item) => sameDay(item, date))) ||
    (calendarProps?.minDate !== undefined && compareDays(date, calendarProps.minDate) < 0) ||
    (calendarProps?.maxDate !== undefined && compareDays(date, calendarProps.maxDate) > 0)
  );
}

export function DatePicker({
  value,
  defaultValue,
  onChange,
  placeholder = "日付を選択",
  locale = "ja-JP",
  disabled,
  calendarProps,
  className,
  onBlur,
  onClick,
  onMouseDown,
  onKeyDown,
  ...inputProps
}: DatePickerProps) {
  const [internalValue, setInternalValue] = useState<Date | undefined>(defaultValue);
  const selected = value !== undefined ? value : internalValue;
  const selectedInputValue = selected && isValidDate(selected) ? formatDateInput(selected) : "";
  const initialInputValue = selectedInputValue;
  const [inputValue, setInputValue] = useState(initialInputValue);
  const [inputState, setInputState] = useState(() => dateInputStateFromValue(initialInputValue));
  const [inputInvalid, setInputInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);

  useEffect(() => {
    setInputValue(selectedInputValue);
    setInputState(dateInputStateFromValue(selectedInputValue));
    setInputInvalid(false);
  }, [selectedInputValue]);

  useEffect(() => {
    if (pendingSelection === null) return;
    inputRef.current?.setSelectionRange(pendingSelection, pendingSelection);
    setPendingSelection(null);
  }, [pendingSelection]);

  const applyDate = (next: Date | undefined) => {
    if (value === undefined) setInternalValue(next);
    const nextValue = next ? formatDateInput(next) : "";
    setInputValue(nextValue);
    setInputState(dateInputStateFromValue(nextValue));
    setInputInvalid(false);
    if (!sameDay(selected, next)) onChange?.(next);
  };

  const commitInput = () => {
    const text = inputValue.trim();
    if (!text) {
      applyDate(undefined);
      return true;
    }
    const next = parseDateInput(text);
    if (!next || isDateUnavailable(next, calendarProps)) {
      setInputInvalid(true);
      return false;
    }
    applyDate(next);
    return true;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("gdg-date-picker-trigger", className)}>
        <CalendarDays className="gdg-date-picker-icon" size={16} aria-hidden="true" />
        <PopoverTrigger asChild>
          <Input
            {...inputProps}
            type="text"
            value={inputValue}
            placeholder={placeholder}
            disabled={disabled}
            ref={inputRef}
            inputMode="numeric"
            aria-haspopup="dialog"
            aria-invalid={inputInvalid ? true : inputProps["aria-invalid"]}
            className="gdg-date-picker-input"
            onChange={(event) => {
              const nextValue = formatDateInputValue(event.target.value);
              setInputValue(nextValue);
              setInputState(dateInputStateFromValue(event.target.value));
              setPendingSelection(nextValue.length);
              if (inputInvalid) setInputInvalid(false);
            }}
            onMouseDown={(event) => {
              onMouseDown?.(event);
              if (event.defaultPrevented || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.select();
              setPendingSelection(event.currentTarget.value.length);
            }}
            onClick={(event) => {
              onClick?.(event);
              if (event.defaultPrevented) return;
              event.currentTarget.select();
              setPendingSelection(event.currentTarget.value.length);
              if (open) event.preventDefault();
              setOpen(true);
            }}
            onBlur={(event) => {
              commitInput();
              onBlur?.(event);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (event.defaultPrevented) return;
              if (/^\d$/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                const selectionStart = event.currentTarget.selectionStart;
                const selectionEnd = event.currentTarget.selectionEnd;
                const replacesValue =
                  selectionStart !== null &&
                  selectionEnd !== null &&
                  selectionStart !== selectionEnd;
                const nextState = appendDateInputDigit(
                  replacesValue ? { year: "", month: "", day: "" } : inputState,
                  event.key,
                );
                const nextValue = formatDateInputState(nextState);
                setInputState(nextState);
                setInputValue(nextValue);
                setPendingSelection(nextValue.length);
                if (inputInvalid) setInputInvalid(false);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (commitInput()) setOpen(false);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setInputValue(selected && isValidDate(selected) ? formatDateInput(selected) : "");
                setInputState(
                  dateInputStateFromValue(
                    selected && isValidDate(selected) ? formatDateInput(selected) : "",
                  ),
                );
                setInputInvalid(false);
                setOpen(false);
              } else if (event.key === "/") {
                event.preventDefault();
              }
            }}
          />
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="gdg-date-picker-content"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Calendar
          {...calendarProps}
          mode="single"
          selected={selected}
          locale={calendarProps?.locale ?? locale}
          onSelect={(next) => {
            if (!(next instanceof Date)) return;
            applyDate(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
