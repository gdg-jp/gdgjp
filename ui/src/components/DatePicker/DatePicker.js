import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Calendar } from "../Calendar";
import { Input } from "../Input";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}
function sameDay(a, b) {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isValidDate(date) {
  return !Number.isNaN(date.getTime());
}
function compareDays(a, b) {
  return (
    new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
    new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  );
}
function formatDateInput(date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
function dateInputStateFromValue(value) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return {
    year: digits.slice(0, 4),
    month: digits.slice(4, 6),
    day: digits.slice(6, 8),
  };
}
function formatDateInputState(state) {
  if (!state.year) return "";
  if (!state.month) return state.year;
  const month = state.month.padStart(2, "0");
  if (!state.day) return `${state.year}/${month}`;
  return `${state.year}/${month}/${state.day.padStart(2, "0")}`;
}
function appendDateInputDigit(state, digit) {
  if (state.year.length < 4) return { ...state, year: `${state.year}${digit}` };
  if (!state.month) return { ...state, month: digit };
  if (state.month.length === 1 && Number(state.month) > 1) {
    return state.day.length < 2 ? { ...state, day: `${state.day}${digit}` } : state;
  }
  if (state.month.length < 2) return { ...state, month: `${state.month}${digit}` };
  if (state.day.length < 2) return { ...state, day: `${state.day}${digit}` };
  return state;
}
function formatDateInputValue(value) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6).padStart(2, "0");
  if (digits.length <= 6) return `${year}/${month}`;
  return `${year}/${month}/${digits.slice(6, 8).padStart(2, "0")}`;
}
function parseDateInput(value) {
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
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return void 0;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return void 0;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : void 0;
}
function isDateUnavailable(date, calendarProps) {
  const disabled = calendarProps?.disabled;
  return (
    (typeof disabled === "function" && disabled(date)) ||
    (Array.isArray(disabled) && disabled.some((item) => sameDay(item, date))) ||
    (calendarProps?.minDate !== void 0 && compareDays(date, calendarProps.minDate) < 0) ||
    (calendarProps?.maxDate !== void 0 && compareDays(date, calendarProps.maxDate) > 0)
  );
}
function DatePicker(props) {
  const valueIsControlled = hasOwn(props, "value");
  const {
    value,
    defaultValue,
    onChange,
    placeholder = "\u65E5\u4ED8\u3092\u9078\u629E",
    locale = "ja-JP",
    disabled,
    calendarProps,
    className,
    onBlur,
    onClick,
    onMouseDown,
    onKeyDown,
    ...inputProps
  } = props;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selected = valueIsControlled ? value : internalValue;
  const selectedInputValue = selected && isValidDate(selected) ? formatDateInput(selected) : "";
  const initialInputValue = selectedInputValue;
  const [inputValue, setInputValue] = useState(initialInputValue);
  const [inputState, setInputState] = useState(() => dateInputStateFromValue(initialInputValue));
  const [inputInvalid, setInputInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const [pendingSelection, setPendingSelection] = useState(null);
  const calendarMonthIsControlled = calendarProps?.month !== void 0;
  const initialCalendarMonth =
    selected && isValidDate(selected)
      ? selected
      : (calendarProps?.defaultMonth ?? /* @__PURE__ */ new Date());
  const [internalMonth, setInternalMonth] = useState(() => startOfMonth(initialCalendarMonth));
  const previousCommittedValue = useRef(selectedInputValue);
  useEffect(() => {
    setInputValue(selectedInputValue);
    setInputState(dateInputStateFromValue(selectedInputValue));
    setInputInvalid(false);
    setPendingSelection(null);
  }, [selectedInputValue]);
  useEffect(() => {
    if (previousCommittedValue.current !== selectedInputValue) {
      if (!calendarMonthIsControlled && selected && isValidDate(selected)) {
        setInternalMonth(startOfMonth(selected));
      }
      previousCommittedValue.current = selectedInputValue;
    }
  }, [calendarMonthIsControlled, selected, selectedInputValue]);
  useEffect(() => {
    if (pendingSelection === null) return;
    inputRef.current?.setSelectionRange(pendingSelection, pendingSelection);
    setPendingSelection(null);
  }, [pendingSelection]);
  const syncInput = (nextValue) => {
    setInputValue(nextValue);
    setInputState(dateInputStateFromValue(nextValue));
    setInputInvalid(false);
  };
  const applyDate = (next) => {
    if (!valueIsControlled) {
      setInternalValue(next);
      syncInput(next ? formatDateInput(next) : "");
    } else {
      syncInput(selectedInputValue);
    }
    if (!sameDay(selected, next)) onChange?.(next);
  };
  const commitInput = () => {
    const text = inputValue.trim();
    if (!text) {
      applyDate(void 0);
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
  const handleMonthChange = (next) => {
    if (!calendarMonthIsControlled) setInternalMonth(startOfMonth(next));
    calendarProps?.onMonthChange?.(next);
  };
  const committedInputValue = selected && isValidDate(selected) ? formatDateInput(selected) : "";
  const calendarMonth = calendarMonthIsControlled ? calendarProps?.month : internalMonth;
  return /* @__PURE__ */ jsxs(Popover, {
    open,
    onOpenChange: setOpen,
    children: [
      /* @__PURE__ */ jsxs("div", {
        className: cn("gdg-date-picker-trigger", className),
        children: [
          /* @__PURE__ */ jsx(CalendarDays, {
            className: "gdg-date-picker-icon",
            size: 16,
            "aria-hidden": "true",
          }),
          /* @__PURE__ */ jsx(PopoverTrigger, {
            asChild: true,
            children: /* @__PURE__ */ jsx(Input, {
              ...inputProps,
              type: "text",
              value: inputValue,
              placeholder,
              disabled,
              ref: inputRef,
              inputMode: "numeric",
              "aria-haspopup": "dialog",
              "aria-invalid": inputInvalid ? true : inputProps["aria-invalid"],
              className: "gdg-date-picker-input",
              onChange: (event) => {
                const nextValue = formatDateInputValue(event.target.value);
                setInputValue(nextValue);
                setInputState(dateInputStateFromValue(event.target.value));
                setPendingSelection(nextValue.length);
                if (inputInvalid) setInputInvalid(false);
              },
              onMouseDown: (event) => {
                onMouseDown?.(event);
                if (event.defaultPrevented || event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.select();
                setPendingSelection(event.currentTarget.value.length);
              },
              onClick: (event) => {
                onClick?.(event);
                if (event.defaultPrevented) return;
                event.currentTarget.select();
                setPendingSelection(event.currentTarget.value.length);
                if (open) event.preventDefault();
                setOpen(true);
              },
              onBlur: (event) => {
                commitInput();
                onBlur?.(event);
              },
              onKeyDown: (event) => {
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
                  syncInput(committedInputValue);
                  setOpen(false);
                } else if (event.key === "/") {
                  event.preventDefault();
                }
              },
            }),
          }),
        ],
      }),
      /* @__PURE__ */ jsx(PopoverContent, {
        align: "start",
        collisionPadding: 12,
        className: "gdg-date-picker-content",
        onOpenAutoFocus: (event) => event.preventDefault(),
        children: /* @__PURE__ */ jsx(Calendar, {
          ...calendarProps,
          mode: "single",
          month: calendarMonth,
          selected,
          locale: calendarProps?.locale ?? locale,
          onMonthChange: handleMonthChange,
          onSelect: (next) => {
            if (!(next instanceof Date)) return;
            applyDate(next);
            setOpen(false);
          },
        }),
      }),
    ],
  });
}
export { DatePicker };
