import { Check, ChevronDown } from "lucide-react";
import { Select as RSelect } from "radix-ui";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useExitPresence, useMotionRef } from "../../hooks";
import { cn } from "../../utils";
import { FieldContext, useField } from "../FormField/field-context";
const SelectMotionContext = createContext(null);
export function Select({ open: controlledOpen, defaultOpen = false, onOpenChange, ...props }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const contentRef = useRef(null);
  const present = useExitPresence(open, contentRef);
  const field = useContext(FieldContext);
  return _jsx(SelectMotionContext.Provider, {
    value: { open, contentRef },
    children: _jsx(RSelect.Root, {
      ...props,
      required: props.required ?? field?.required,
      disabled: props.disabled ?? field?.disabled,
      open: present,
      onOpenChange: (next) => {
        if (controlledOpen === undefined) setInternalOpen(next);
        onOpenChange?.(next);
      },
    }),
  });
}
export const SelectValue = RSelect.Value;
export function SelectTrigger({ children, className, ...props }) {
  const field = useField(props);
  const motion = useContext(SelectMotionContext);
  return _jsxs(RSelect.Trigger, {
    ...props,
    ...field,
    "aria-expanded": motion?.open,
    className: cn("gdg-input", "gdg-select-trigger", className),
    children: [children, _jsx(RSelect.Icon, { children: _jsx(ChevronDown, { size: 16 }) })],
  });
}
export function SelectContent({ ref, children, className, ...props }) {
  const motion = useContext(SelectMotionContext);
  const motionRef = useMotionRef(ref);
  const contentRef = motion?.contentRef;
  const setRef = useCallback(
    (node) => {
      if (contentRef) contentRef.current = node;
      return motionRef(node);
    },
    [contentRef, motionRef],
  );
  return _jsx(RSelect.Portal, {
    children: _jsxs(RSelect.Content, {
      ref: setRef,
      position: "popper",
      sideOffset: 4,
      ...props,
      "data-state": motion?.open ? "open" : "closed",
      inert: motion ? !motion.open : undefined,
      className: cn("gdg-popup", "gdg-select-content", className),
      children: [
        _jsx(RSelect.ScrollUpButton, { children: "\u2191" }),
        _jsx(RSelect.Viewport, { children: children }),
        _jsx(RSelect.ScrollDownButton, { children: "\u2193" }),
      ],
    }),
  });
}
export function SelectItem({ children, className, ...props }) {
  return _jsxs(RSelect.Item, {
    ...props,
    className: cn("gdg-menu-item", className),
    children: [
      _jsx(RSelect.ItemText, { children: children }),
      _jsx(RSelect.ItemIndicator, { children: _jsx(Check, { size: 16 }) }),
    ],
  });
}
export const SelectGroup = RSelect.Group;
export const SelectLabel = RSelect.Label;
