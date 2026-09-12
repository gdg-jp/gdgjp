import { ContextMenu as RM } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
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
export function ContextMenuCheckboxItem({ className, ...props }) {
  return _jsx(RM.CheckboxItem, { ...props, className: cn("gdg-menu-item", className) });
}
export function ContextMenuRadioItem({ className, ...props }) {
  return _jsx(RM.RadioItem, { ...props, className: cn("gdg-menu-item", className) });
}
export function ContextMenuLabel({ className, ...props }) {
  return _jsx(RM.Label, { ...props, className: cn("gdg-menu-label", className) });
}
export function ContextMenuSeparator({ className, ...props }) {
  return _jsx(RM.Separator, { ...props, className: cn("gdg-separator", className) });
}
export const ContextMenuPortal = RM.Portal;
export const ContextMenuArrow = RM.Arrow;
