import { NavigationMenu as RN } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export function NavigationMenu({ className, ...props }) {
  return _jsx(RN.Root, { ...props, className: cn("gdg-navigation-menu", className) });
}
export function NavigationMenuList({ className, ...props }) {
  return _jsx(RN.List, { ...props, className: cn("gdg-navigation-menu-list", className) });
}
export const NavigationMenuItem = RN.Item;
export function NavigationMenuTrigger({ className, ...props }) {
  return _jsx(RN.Trigger, { ...props, className: cn("gdg-navigation-menu-trigger", className) });
}
export function NavigationMenuLink({ className, ...props }) {
  return _jsx(RN.Link, { ...props, className: cn("gdg-navigation-menu-link", className) });
}
export function NavigationMenuContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RN.Content, {
    ref: motionRef,
    className: cn("gdg-navigation-menu-content", className),
    ...props,
  });
}
export function NavigationMenuViewport({ className, ...props }) {
  return _jsx(RN.Viewport, { ...props, className: cn("gdg-navigation-menu-viewport", className) });
}
export function NavigationMenuIndicator({ className, ...props }) {
  return _jsx(RN.Indicator, {
    ...props,
    className: cn("gdg-navigation-menu-indicator", className),
  });
}
export const NavigationMenuSub = RN.Sub;
