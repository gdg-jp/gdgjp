import { Check } from "lucide-react";
import { ContextMenu as RM } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const ContextMenu = RM.Root;
export const ContextMenuTrigger = RM.Trigger;
export const ContextMenuGroup = RM.Group;
export const ContextMenuRadioGroup = RM.RadioGroup;
export const ContextMenuSub = RM.Sub;
export function ContextMenuContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RM.Portal, {
    children: _jsx(RM.Content, {
      ref: motionRef,
      ...props,
      className: cn("gdg-popup", "gdg-context-menu", className),
    }),
  });
}
export function ContextMenuSubContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RM.SubContent, {
    ref: motionRef,
    ...props,
    className: cn("gdg-popup", "gdg-context-menu", className),
  });
}
export const ContextMenuSubTrigger = RM.SubTrigger;
export function ContextMenuItem({ className, ...props }) {
  return _jsx(RM.Item, { ...props, className: cn("gdg-menu-item", className) });
}
export function ContextMenuCheckboxItem({ children, className, ...props }) {
  return _jsxs(RM.CheckboxItem, {
    ...props,
    className: cn("gdg-menu-item", className),
    children: [
      _jsx("span", { className: "gdg-menu-item-label", children: children }),
      _jsx("span", {
        className: "gdg-menu-item-indicator",
        "aria-hidden": "true",
        children: _jsx(RM.ItemIndicator, { children: _jsx(Check, { size: 16 }) }),
      }),
    ],
  });
}
export function ContextMenuRadioItem({ children, className, ...props }) {
  return _jsxs(RM.RadioItem, {
    ...props,
    className: cn("gdg-menu-item", className),
    children: [
      _jsx("span", { className: "gdg-menu-item-label", children: children }),
      _jsx("span", {
        className: "gdg-menu-item-indicator",
        "aria-hidden": "true",
        children: _jsx(RM.ItemIndicator, { children: _jsx(Check, { size: 16 }) }),
      }),
    ],
  });
}
export function ContextMenuLabel({ className, ...props }) {
  return _jsx(RM.Label, { ...props, className: cn("gdg-menu-label", className) });
}
export function ContextMenuSeparator({ className, ...props }) {
  return _jsx(RM.Separator, { ...props, className: cn("gdg-separator", className) });
}
export const ContextMenuPortal = RM.Portal;
export const ContextMenuArrow = RM.Arrow;
