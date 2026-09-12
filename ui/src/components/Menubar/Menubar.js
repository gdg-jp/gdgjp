import { Check } from "lucide-react";
import { Menubar as RM } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export function Menubar({ className, ...props }) {
  return _jsx(RM.Root, { ...props, className: cn("gdg-menubar", className) });
}
export function MenubarMenu({ children, ...props }) {
  return _jsx(RM.Menu, { ...props, children: children });
}
export function MenubarTrigger({ className, ...props }) {
  return _jsx(RM.Trigger, { ...props, className: cn("gdg-menubar-trigger", className) });
}
export function MenubarContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RM.Portal, {
    children: _jsx(RM.Content, {
      ref: motionRef,
      sideOffset: 4,
      ...props,
      className: cn("gdg-popup", "gdg-menubar-content", className),
    }),
  });
}
export function MenubarItem({ className, ...props }) {
  return _jsx(RM.Item, { ...props, className: cn("gdg-menu-item", className) });
}
export function MenubarCheckboxItem({ children, className, ...props }) {
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
export function MenubarRadioGroup({ ...props }) {
  return _jsx(RM.RadioGroup, { ...props });
}
export function MenubarRadioItem({ children, className, ...props }) {
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
export function MenubarLabel({ className, ...props }) {
  return _jsx(RM.Label, { ...props, className: cn("gdg-menu-label", className) });
}
export function MenubarSeparator({ className, ...props }) {
  return _jsx(RM.Separator, { ...props, className: cn("gdg-separator", className) });
}
export const MenubarGroup = RM.Group;
export const MenubarSub = RM.Sub;
export const MenubarSubTrigger = RM.SubTrigger;
export function MenubarSubContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RM.SubContent, {
    ref: motionRef,
    ...props,
    className: cn("gdg-popup", "gdg-menubar-content", className),
  });
}
export const MenubarPortal = RM.Portal;
export const MenubarArrow = RM.Arrow;
