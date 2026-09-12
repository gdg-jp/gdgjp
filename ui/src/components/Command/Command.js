import { Search } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../Dialog";
const CommandContext = createContext(null);
const optionRole = "option";
function useCommandContext() {
  const context = useContext(CommandContext);
  if (!context) throw new Error("Command parts must be used inside Command");
  return context;
}
export function Command({
  value,
  defaultValue = "",
  onValueChange,
  shouldFilter = true,
  className,
  children,
  onKeyDown,
  ...props
}) {
  const [internalQuery, setInternalQuery] = useState(defaultValue);
  const query = value ?? internalQuery;
  const [hasFiltered, setHasFiltered] = useState(() => Boolean(defaultValue || value));
  const [items, setItems] = useState([]);
  const [activeValue, setActiveValue] = useState();
  const listId = useId();
  const setQuery = (next) => {
    if (next !== query) setHasFiltered(true);
    if (value === undefined) setInternalQuery(next);
    onValueChange?.(next);
  };
  useEffect(() => {
    if (query) setHasFiltered(true);
  }, [query]);
  const registerItem = useCallback((item) => {
    setItems((current) => {
      const index = current.findIndex((candidate) => candidate.id === item.id);
      if (index === -1) return [...current, item];
      const previous = current[index];
      if (
        previous?.value === item.value &&
        previous?.disabled === item.disabled &&
        previous?.ref === item.ref &&
        previous?.keywords.length === item.keywords.length &&
        previous.keywords.every((keyword, keywordIndex) => keyword === item.keywords[keywordIndex])
      )
        return current;
      const next = current.slice();
      next[index] = item;
      return next;
    });
  }, []);
  const unregisterItem = useCallback((id) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !item.disabled &&
          (!shouldFilter ||
            !query ||
            `${item.value} ${item.keywords.join(" ")}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [items, query, shouldFilter],
  );
  const selectItem = (selectedValue) => {
    setActiveValue(selectedValue);
    const item = items.find((candidate) => candidate.value === selectedValue);
    item?.ref?.click();
  };
  const moveActive = (direction) => {
    if (!visibleItems.length) return;
    const current = Math.max(
      visibleItems.findIndex((item) => item.value === activeValue),
      0,
    );
    const next = visibleItems[(current + direction + visibleItems.length) % visibleItems.length];
    if (!next) return;
    setActiveValue(next.value);
    next.ref?.focus();
  };
  return _jsxs(CommandContext.Provider, {
    value: {
      query,
      setQuery,
      shouldFilter,
      activeValue,
      setActiveValue,
      registerItem,
      unregisterItem,
      selectItem,
      itemCount: visibleItems.length,
      listId,
    },
    children: [
      _jsx("div", {
        ...props,
        "data-command": "true",
        "data-command-filtered": hasFiltered || query ? "true" : undefined,
        tabIndex: props.tabIndex ?? -1,
        className: cn("gdg-command", className),
        onKeyDown: (event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveActive(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveActive(-1);
          } else if (event.key === "Home") {
            event.preventDefault();
            visibleItems[0]?.ref?.focus();
            if (visibleItems[0]) setActiveValue(visibleItems[0].value);
          } else if (event.key === "End") {
            event.preventDefault();
            const last = visibleItems.at(-1);
            last?.ref?.focus();
            if (last) setActiveValue(last.value);
          } else if (event.key === "Enter" && activeValue) {
            event.preventDefault();
            selectItem(activeValue);
          }
          onKeyDown?.(event);
        },
        "aria-label": props["aria-label"] ?? "コマンド",
        children: children,
      }),
      _jsxs("span", {
        className: "gdg-sr-only",
        "aria-live": "polite",
        children: [visibleItems.length, " \u4EF6\u306E\u5019\u88DC"],
      }),
    ],
  });
}
export function CommandInput({ ref, className, value, defaultValue, onChange, ...props }) {
  const context = useCommandContext();
  const inputRef = useRef(null);
  const setRef = (node) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return _jsxs("div", {
    className: "gdg-command-input-wrap",
    children: [
      _jsx(Search, { size: 16, "aria-hidden": "true" }),
      _jsx("input", {
        ...props,
        ref: setRef,
        value: value ?? context.query,
        defaultValue: value === undefined ? undefined : defaultValue,
        "aria-label": props["aria-label"] ?? "検索",
        "aria-controls": context.listId,
        "aria-expanded": "true",
        "aria-autocomplete": "list",
        role: "combobox",
        className: cn("gdg-command-input", className),
        onChange: (event) => {
          context.setQuery(event.target.value);
          onChange?.(event);
        },
      }),
    ],
  });
}
export function CommandList({ className, ...props }) {
  const context = useCommandContext();
  return _jsx("div", {
    ...props,
    id: props.id ?? context.listId,
    role: props.role ?? "listbox",
    className: cn("gdg-command-list", className),
  });
}
export function CommandEmpty({ className, children = "結果がありません。", ...props }) {
  const context = useCommandContext();
  return _jsx("div", {
    ...props,
    hidden: context.itemCount > 0,
    className: cn("gdg-command-empty", className),
    children: children,
  });
}
export function CommandGroup({ heading, className, children, ...props }) {
  const headingId = useId();
  return _jsxs("div", {
    ...props,
    "aria-labelledby": heading ? headingId : undefined,
    className: cn("gdg-command-group", className),
    children: [
      heading &&
        _jsx("div", { id: headingId, className: "gdg-command-heading", children: heading }),
      children,
    ],
  });
}
export function CommandItem({
  value,
  keywords = [],
  disabled = false,
  className,
  children,
  onSelect,
  onFocus,
  ...props
}) {
  const context = useCommandContext();
  const { activeValue, query, registerItem, setActiveValue, shouldFilter, unregisterItem } =
    context;
  const id = useId();
  const itemRef = useRef(null);
  const normalizedQuery = query.toLowerCase();
  const keywordKey = keywords.join("\u0000");
  const itemKeywords = useMemo(() => (keywordKey ? keywordKey.split("\u0000") : []), [keywordKey]);
  const visible =
    !shouldFilter ||
    !normalizedQuery ||
    `${value} ${itemKeywords.join(" ")}`.toLowerCase().includes(normalizedQuery);
  useEffect(() => {
    registerItem({ id, value, keywords: itemKeywords, disabled, ref: itemRef.current });
    return () => unregisterItem(id);
  }, [disabled, id, itemKeywords, registerItem, unregisterItem, value]);
  return _jsx("button", {
    ...props,
    ref: itemRef,
    type: props.type ?? "button",
    role: optionRole,
    "aria-selected": activeValue === value,
    "aria-disabled": disabled || undefined,
    "aria-hidden": visible ? undefined : true,
    disabled: disabled,
    inert: !visible ? true : undefined,
    tabIndex: visible ? props.tabIndex : -1,
    "data-command-hidden": visible ? undefined : "true",
    className: cn("gdg-command-item", className),
    onFocus: (event) => {
      setActiveValue(value);
      onFocus?.(event);
    },
    onMouseMove: () => setActiveValue(value),
    onClick: (event) => {
      if (disabled) return;
      onSelect?.(value);
      props.onClick?.(event);
    },
    children: children,
  });
}
export function CommandShortcut({ className, ...props }) {
  return _jsx("span", {
    ...props,
    "aria-hidden": "true",
    className: cn("gdg-command-shortcut", className),
  });
}
export function CommandSeparator({ className, ...props }) {
  return _jsx("hr", { ...props, className: cn("gdg-command-separator", className) });
}
export function CommandLoading({ className, ...props }) {
  return _jsx("output", {
    ...props,
    "aria-live": "polite",
    className: cn("gdg-command-loading", className),
    children: "\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026",
  });
}
export function CommandDialog({
  open,
  defaultOpen,
  onOpenChange,
  title = "コマンドパレット",
  description = "実行する操作を検索してください。",
  children,
}) {
  return _jsx(Dialog, {
    open: open,
    defaultOpen: defaultOpen,
    onOpenChange: onOpenChange,
    children: _jsxs(DialogContent, {
      className: "gdg-command-dialog",
      children: [
        _jsx(DialogTitle, { className: "gdg-sr-only", children: title }),
        _jsx(DialogDescription, { className: "gdg-sr-only", children: description }),
        children,
      ],
    }),
  });
}
