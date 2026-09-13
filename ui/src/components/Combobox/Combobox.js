import { Check } from "lucide-react";
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
import { jsx, jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";
const ComboboxContext = createContext(null);
const optionRole = "option";
const emptyKeywords = [];
function assignRef(ref, node) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}
function useCombobox() {
  const context = useContext(ComboboxContext);
  if (!context) throw new Error("Combobox parts must be used inside Combobox");
  return context;
}
function itemMatchesQuery(item, query, shouldFilter) {
  return (
    !shouldFilter ||
    !query ||
    `${item.value} ${item.keywords.join(" ")}`.toLowerCase().includes(query.toLowerCase())
  );
}
function Combobox({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  value: controlledValue,
  defaultValue,
  onValueChange,
  query: controlledQuery,
  defaultQuery = "",
  onQueryChange,
  activeValue: controlledActiveValue,
  defaultActiveValue,
  onActiveValueChange,
  shouldFilter = true,
  closeOnSelect = true,
  children,
}) {
  const openIsControlled = controlledOpen !== void 0;
  const valueIsControlled = controlledValue !== void 0;
  const queryIsControlled = controlledQuery !== void 0;
  const activeValueIsControlled = controlledActiveValue !== void 0;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalValue, setInternalValue] = useState(defaultValue ?? null);
  const [internalQuery, setInternalQuery] = useState(defaultQuery);
  const [internalActiveValue, setInternalActiveValue] = useState(defaultActiveValue ?? null);
  const [items, setItems] = useState([]);
  const defaultListId = `gdg-combobox-list-${useId().replace(/:/g, "")}`;
  const [listId, setListId] = useState(defaultListId);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const skipCloseFocusRef = useRef(false);
  const forceFirstActiveRef = useRef(defaultActiveValue === void 0);
  const open = openIsControlled ? controlledOpen : internalOpen;
  const value = valueIsControlled ? (controlledValue ?? null) : internalValue;
  const query = queryIsControlled ? controlledQuery : internalQuery;
  const activeValue = activeValueIsControlled
    ? (controlledActiveValue ?? null)
    : internalActiveValue;
  const updateItems = useCallback((updater) => {
    setItems((current) => {
      return updater(current);
    });
  }, []);
  const registerItem = useCallback(
    (item) => {
      updateItems((current) => {
        const index = current.findIndex((candidate) => candidate.id === item.id);
        if (index === -1) return [...current, item];
        const previous = current[index];
        if (
          previous?.value === item.value &&
          previous.disabled === item.disabled &&
          previous.hidden === item.hidden &&
          previous.ref === item.ref &&
          previous.keywords.length === item.keywords.length &&
          previous.keywords.every(
            (keyword, keywordIndex) => keyword === item.keywords[keywordIndex],
          )
        )
          return current;
        const next = current.slice();
        next[index] = item;
        return next;
      });
    },
    [updateItems],
  );
  const unregisterItem = useCallback(
    (id) => {
      updateItems((current) => {
        const next = current.filter((item) => item.id !== id);
        return next.length === current.length ? current : next;
      });
    },
    [updateItems],
  );
  const getDomItems = useCallback(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const nodes = listRef.current?.querySelectorAll('[data-combobox-item="true"]');
    if (!nodes?.length) return items;
    return Array.from(nodes)
      .map((node) => byId.get(node.getAttribute("data-combobox-item-id") ?? ""))
      .filter((item) => item !== void 0);
  }, [items]);
  const getVisibleItems = useCallback(() => {
    return getDomItems().filter(
      (item) => !item.hidden && itemMatchesQuery(item, query, shouldFilter),
    );
  }, [getDomItems, query, shouldFilter]);
  const getEligibleItems = useCallback(() => {
    return getVisibleItems().filter((item) => {
      const node = item.ref;
      return (
        !item.disabled &&
        !!node &&
        !node.hidden &&
        !node.closest("[hidden]") &&
        !node.disabled &&
        node.getAttribute("aria-disabled") !== "true" &&
        node.getAttribute("aria-hidden") !== "true"
      );
    });
  }, [getVisibleItems]);
  const setInputNode = useCallback((node) => {
    inputRef.current = node;
  }, []);
  const setTriggerNode = useCallback((node) => {
    triggerRef.current = node;
  }, []);
  const setListNode = useCallback((node) => {
    listRef.current = node;
  }, []);
  const skipCloseFocus = useCallback(() => {
    skipCloseFocusRef.current = true;
  }, []);
  const consumeSkipCloseFocus = useCallback(() => {
    const shouldSkip = skipCloseFocusRef.current;
    skipCloseFocusRef.current = false;
    return shouldSkip;
  }, []);
  const setQuery = useCallback(
    (next) => {
      if (!queryIsControlled) setInternalQuery(next);
      onQueryChange?.(next);
    },
    [onQueryChange, queryIsControlled],
  );
  const setActiveValue = useCallback(
    (next) => {
      if (!activeValueIsControlled) setInternalActiveValue(next);
      onActiveValueChange?.(next);
    },
    [activeValueIsControlled, onActiveValueChange],
  );
  const setOpen = useCallback(
    (next) => {
      if (!openIsControlled) setInternalOpen(next);
      if (!next) {
        forceFirstActiveRef.current = true;
        setActiveValue(null);
      }
      onOpenChange?.(next);
    },
    [onOpenChange, openIsControlled, setActiveValue],
  );
  const selectValue = useCallback(
    (next, itemId) => {
      const item = getEligibleItems().find(
        (candidate) => candidate.value === next && (itemId === void 0 || candidate.id === itemId),
      );
      if (!item) return false;
      setActiveValue(next);
      if (!valueIsControlled) setInternalValue(next);
      onValueChange?.(next);
      if (closeOnSelect) setOpen(false);
      else inputRef.current?.focus();
      return true;
    },
    [closeOnSelect, getEligibleItems, onValueChange, setActiveValue, setOpen, valueIsControlled],
  );
  const getActiveDescendant = useCallback(() => {
    if (!open || activeValue === null) return void 0;
    const item = getEligibleItems().find((candidate) => candidate.value === activeValue);
    return item?.id;
  }, [activeValue, getEligibleItems, open]);
  const visibleItems = useMemo(
    () => items.filter((item) => itemMatchesQuery(item, query, shouldFilter)),
    [items, query, shouldFilter],
  );
  useEffect(() => {
    if (!open) {
      forceFirstActiveRef.current = true;
      if (activeValue !== null) setActiveValue(null);
      return;
    }
    const eligibleItems = getEligibleItems();
    if (!eligibleItems.length) {
      if (activeValue !== null) setActiveValue(null);
      return;
    }
    const currentItem = eligibleItems.find((item) => item.value === activeValue);
    const nextValue =
      forceFirstActiveRef.current || !currentItem
        ? (eligibleItems[0]?.value ?? null)
        : currentItem.value;
    forceFirstActiveRef.current = false;
    if (nextValue !== activeValue) setActiveValue(nextValue);
  }, [activeValue, getEligibleItems, open, setActiveValue]);
  const context = useMemo(
    () => ({
      open,
      query,
      value,
      activeValue,
      shouldFilter,
      listId,
      defaultListId,
      itemCount: visibleItems.length,
      inputRef,
      triggerRef,
      skipCloseFocus,
      consumeSkipCloseFocus,
      setInputNode,
      setTriggerNode,
      setListNode,
      setListId,
      setQuery,
      setActiveValue,
      setOpen,
      registerItem,
      unregisterItem,
      selectValue,
      getVisibleItems,
      getEligibleItems,
      getActiveDescendant,
    }),
    [
      activeValue,
      defaultListId,
      getActiveDescendant,
      getEligibleItems,
      getVisibleItems,
      listId,
      open,
      query,
      registerItem,
      selectValue,
      setActiveValue,
      setInputNode,
      setListNode,
      setOpen,
      setQuery,
      setTriggerNode,
      shouldFilter,
      skipCloseFocus,
      consumeSkipCloseFocus,
      unregisterItem,
      value,
      visibleItems.length,
    ],
  );
  return /* @__PURE__ */ jsx(ComboboxContext.Provider, {
    value: context,
    children: /* @__PURE__ */ jsx(Popover, { open, onOpenChange: setOpen, children }),
  });
}
function ComboboxTrigger({ ref, className, onKeyDown, ...props }) {
  const context = useCombobox();
  return /* @__PURE__ */ jsx(PopoverTrigger, {
    ...props,
    ref: (node) => {
      context.setTriggerNode(node);
      assignRef(ref, node);
    },
    "aria-haspopup": "listbox",
    "aria-expanded": context.open,
    className: cn("gdg-combobox-trigger", className),
    onKeyDown: (event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      context.setOpen(true);
    },
  });
}
function ComboboxContent({ className, onOpenAutoFocus, onCloseAutoFocus, ...props }) {
  const context = useCombobox();
  return /* @__PURE__ */ jsx(PopoverContent, {
    ...props,
    className: cn("gdg-combobox-content", className),
    onOpenAutoFocus: (event) => {
      onOpenAutoFocus?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      context.inputRef.current?.focus();
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      if (context.consumeSkipCloseFocus()) {
        event.preventDefault();
        return;
      }
      if (context.triggerRef.current !== context.inputRef.current) return;
      event.preventDefault();
      context.inputRef.current?.focus();
    },
  });
}
function ComboboxInput({
  ref,
  className,
  value: inputValue,
  defaultValue: _defaultValue,
  onChange,
  onKeyDown,
  onBlur,
  ...props
}) {
  const context = useCombobox();
  return /* @__PURE__ */ jsx("input", {
    ...props,
    ref: (node) => {
      context.setInputNode(node);
      assignRef(ref, node);
    },
    value: inputValue !== void 0 ? inputValue : context.query,
    "aria-label": props["aria-label"] ?? "\u5019\u88DC\u3092\u691C\u7D22",
    role: "combobox",
    "aria-controls": context.listId,
    "aria-expanded": context.open,
    "aria-autocomplete": "list",
    "aria-activedescendant": context.getActiveDescendant(),
    className: cn("gdg-input", "gdg-combobox-input", className),
    onChange: (event) => {
      onChange?.(event);
      if (!event.defaultPrevented) context.setQuery(event.target.value);
    },
    onBlur: (event) => {
      onBlur?.(event);
      if (!event.defaultPrevented) context.setOpen(false);
    },
    onKeyDown: (event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        context.setOpen(false);
        return;
      }
      if (event.key === "Tab") {
        context.skipCloseFocus();
        context.setOpen(false);
        return;
      }
      const eligibleItems = context.getEligibleItems();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!context.open) {
          context.setOpen(true);
          return;
        }
        if (!eligibleItems.length) return;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const currentIndex = eligibleItems.findIndex((item) => item.value === context.activeValue);
        const nextIndex =
          currentIndex < 0
            ? direction > 0
              ? 0
              : eligibleItems.length - 1
            : Math.min(Math.max(currentIndex + direction, 0), eligibleItems.length - 1);
        const next = eligibleItems[nextIndex];
        if (next) context.setActiveValue(next.value);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        if (!context.open) return;
        event.preventDefault();
        const next = event.key === "Home" ? eligibleItems[0] : eligibleItems.at(-1);
        if (next) context.setActiveValue(next.value);
        return;
      }
      if (event.key !== "Enter" || !context.open) return;
      event.preventDefault();
      const active = eligibleItems.find((item) => item.value === context.activeValue);
      if (active) active.ref?.click();
    },
  });
}
function ComboboxList({ ref, className, id, ...props }) {
  const context = useCombobox();
  const resolvedId = id ?? context.listId;
  useEffect(() => {
    context.setListId(resolvedId);
    return () => context.setListId(context.defaultListId);
  }, [context.defaultListId, context.setListId, resolvedId]);
  return /* @__PURE__ */ jsx("div", {
    ...props,
    ref: (node) => {
      context.setListNode(node);
      assignRef(ref, node);
    },
    id: resolvedId,
    role: props.role ?? "listbox",
    className: cn("gdg-combobox-list", className),
  });
}
function ComboboxEmpty({
  className,
  children = "\u5019\u88DC\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
  hidden,
  ...props
}) {
  const context = useCombobox();
  return /* @__PURE__ */ jsx("div", {
    ...props,
    hidden: hidden || context.itemCount > 0,
    className: cn("gdg-combobox-empty", className),
    children,
  });
}
function ComboboxGroup({ className, ...props }) {
  return /* @__PURE__ */ jsx("div", {
    ...props,
    role: props.role ?? "group",
    className: cn("gdg-combobox-group", className),
  });
}
function ComboboxItem({
  ref,
  id,
  value,
  keywords: providedKeywords,
  className,
  children,
  hidden,
  disabled,
  onSelect,
  onClick,
  onPointerDown,
  onPointerMove,
  ...props
}) {
  const context = useCombobox();
  const generatedId = `gdg-combobox-option-${useId().replace(/:/g, "")}`;
  const itemId = id ?? generatedId;
  const keywords = providedKeywords ?? emptyKeywords;
  const itemDisabled =
    Boolean(disabled) || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const itemHidden = Boolean(hidden);
  const record = {
    id: itemId,
    value,
    keywords,
    disabled: itemDisabled,
    hidden: itemHidden,
    ref: null,
  };
  const itemRef = useRef(null);
  const itemDataRef = useRef({ value, keywords, disabled: itemDisabled, hidden: itemHidden });
  const forwardedRef = useRef(ref);
  itemDataRef.current = { value, keywords, disabled: itemDisabled, hidden: itemHidden };
  forwardedRef.current = ref;
  const visible = !itemHidden && itemMatchesQuery(record, context.query, context.shouldFilter);
  const selected = context.value === value;
  const active = context.activeValue === value && visible && !itemDisabled;
  const setItemRef = useCallback(
    (node) => {
      itemRef.current = node;
      assignRef(forwardedRef.current, node);
      if (!node) {
        context.unregisterItem(itemId);
        return;
      }
      const itemData = itemDataRef.current;
      context.registerItem({ id: itemId, ...itemData, ref: node });
    },
    [context.registerItem, context.unregisterItem, itemId],
  );
  useEffect(() => {
    context.registerItem({
      id: itemId,
      value,
      keywords,
      disabled: itemDisabled,
      hidden: itemHidden,
      ref: itemRef.current,
    });
  }, [context.registerItem, itemDisabled, itemHidden, itemId, keywords, value]);
  useEffect(() => () => context.unregisterItem(itemId), [context.unregisterItem, itemId]);
  return /* @__PURE__ */ jsx("div", {
    "aria-hidden": visible ? void 0 : true,
    inert: visible ? void 0 : true,
    "data-combobox-hidden": visible ? void 0 : "true",
    className: "gdg-combobox-item-shell",
    children: /* @__PURE__ */ jsxs("button", {
      ...props,
      ref: setItemRef,
      id: itemId,
      type: props.type ?? "button",
      role: optionRole,
      "data-combobox-item": "true",
      "data-combobox-item-id": itemId,
      "data-active": active ? "true" : void 0,
      "aria-hidden": visible ? void 0 : true,
      "aria-selected": selected,
      "aria-disabled": itemDisabled ? true : props["aria-disabled"],
      hidden,
      disabled,
      tabIndex: -1,
      className: cn("gdg-combobox-item", className),
      onPointerDown: (event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented || event.pointerType === "touch" || event.button !== 0) return;
        event.preventDefault();
      },
      onPointerMove: (event) => {
        onPointerMove?.(event);
        if (!event.defaultPrevented && !itemDisabled && visible) context.setActiveValue(value);
      },
      onClick: (event) => {
        if (!context.getEligibleItems().some((item) => item.id === itemId)) return;
        onClick?.(event);
        if (event.defaultPrevented) return;
        onSelect?.(value);
        context.selectValue(value, itemId);
      },
      children: [
        /* @__PURE__ */ jsx("span", { children }),
        selected && /* @__PURE__ */ jsx(Check, { size: 16, "aria-hidden": "true" }),
      ],
    }),
  });
}
export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
};
