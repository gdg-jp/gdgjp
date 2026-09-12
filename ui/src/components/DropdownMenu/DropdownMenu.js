import { Check } from "lucide-react";
import { DropdownMenu as RM } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const DropdownMenu = RM.Root;
export const DropdownMenuTrigger = RM.Trigger;
export function DropdownMenuContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RM.Portal, {
    children: _jsx(RM.Content, {
      ref: motionRef,
      sideOffset: 4,
      ...props,
      className: cn("gdg-popup", "gdg-menu", className),
    }),
  });
}
export function DropdownMenuItem({ className, ...props }) {
  return _jsx(RM.Item, { ...props, className: cn("gdg-menu-item", className) });
}
export function DropdownMenuCheckboxItem({ children, className, ...props }) {
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
export const DropdownMenuGroup = RM.Group;
export const DropdownMenuRadioGroup = RM.RadioGroup;
export function DropdownMenuRadioItem({ children, className, ...props }) {
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
export function DropdownMenuLabel({ className, ...props }) {
  return _jsx(RM.Label, { ...props, className: cn("gdg-menu-label", className) });
}
export function DropdownMenuSeparator(props) {
  return _jsx(RM.Separator, { ...props, className: cn("gdg-separator", props.className) });
}
