import { Check } from "lucide-react";
import { createContext, useContext, useId, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";
const ComboboxContext = createContext(null);
const optionRole = "option";
function useCombobox() {
  const context = useContext(ComboboxContext);
  if (!context) throw new Error("Combobox parts must be used inside Combobox");
  return context;
}
export function Combobox({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  value,
  defaultValue,
  onValueChange,
  children,
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const listId = `gdg-combobox-list-${useId().replace(/:/g, "")}`;
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const setValue = (next) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };
  return _jsx(ComboboxContext.Provider, {
    value: {
      open,
      query,
      setQuery,
      value: value ?? internalValue,
      setValue,
      close: () => setOpen(false),
      listId,
    },
    children: _jsx(Popover, { open: open, onOpenChange: setOpen, children: children }),
  });
}
export function ComboboxTrigger({ className, ...props }) {
  const context = useCombobox();
  return _jsx(PopoverTrigger, {
    ...props,
    "aria-haspopup": "listbox",
    "aria-expanded": context.open,
    className: cn("gdg-combobox-trigger", className),
  });
}
export function ComboboxContent({ className, ...props }) {
  return _jsx(PopoverContent, { ...props, className: cn("gdg-combobox-content", className) });
}
export function ComboboxInput({ className, ...props }) {
  const context = useCombobox();
  return _jsx("input", {
    ...props,
    value: props.value ?? context.query,
    "aria-label": props["aria-label"] ?? "候補を検索",
    role: "combobox",
    "aria-controls": context.listId,
    "aria-expanded": context.open,
    "aria-autocomplete": "list",
    className: cn("gdg-input", "gdg-combobox-input", className),
    onChange: (event) => {
      context.setQuery(event.target.value);
      props.onChange?.(event);
    },
  });
}
export function ComboboxList({ className, ...props }) {
  const context = useCombobox();
  return _jsx("div", {
    ...props,
    id: props.id ?? context.listId,
    role: props.role ?? "listbox",
    className: cn("gdg-combobox-list", className),
  });
}
export function ComboboxEmpty({ className, children = "候補がありません。", ...props }) {
  return _jsx("div", {
    ...props,
    className: cn("gdg-combobox-empty", className),
    children: children,
  });
}
export function ComboboxGroup({ className, ...props }) {
  return _jsx("div", {
    ...props,
    role: props.role ?? "group",
    className: cn("gdg-combobox-group", className),
  });
}
export function ComboboxItem({ value, keywords = [], className, children, onSelect, ...props }) {
  const context = useCombobox();
  const query = context.query.toLowerCase();
  const visible = !query || `${value} ${keywords.join(" ")}`.toLowerCase().includes(query);
  const selected = context.value === value;
  return _jsx("div", {
    "aria-hidden": visible ? undefined : true,
    inert: visible ? undefined : true,
    "data-combobox-hidden": visible ? undefined : "true",
    className: "gdg-combobox-item-shell",
    children: _jsxs("button", {
      ...props,
      type: props.type ?? "button",
      role: optionRole,
      "aria-hidden": visible ? undefined : true,
      "aria-selected": selected,
      tabIndex: visible ? props.tabIndex : -1,
      className: cn("gdg-combobox-item", className),
      onClick: (event) => {
        onSelect?.(value);
        context.setValue(value);
        context.close();
        props.onClick?.(event);
      },
      children: [
        _jsx("span", { children: children }),
        selected && _jsx(Check, { size: 16, "aria-hidden": "true" }),
      ],
    }),
  });
}
