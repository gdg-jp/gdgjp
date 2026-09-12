import { DropdownMenu as RM } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
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
export const DropdownMenuGroup = RM.Group;
export function DropdownMenuLabel({ className, ...props }) {
  return _jsx(RM.Label, { ...props, className: cn("gdg-menu-label", className) });
}
export function DropdownMenuSeparator(props) {
  return _jsx(RM.Separator, { ...props, className: cn("gdg-separator", props.className) });
}
