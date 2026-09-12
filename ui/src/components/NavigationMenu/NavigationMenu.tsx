import { NavigationMenu as RN } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export function NavigationMenu({ className, ...props }: ComponentProps<typeof RN.Root>) {
  return <RN.Root {...props} className={cn("gdg-navigation-menu", className)} />;
}

export function NavigationMenuList({ className, ...props }: ComponentProps<typeof RN.List>) {
  return <RN.List {...props} className={cn("gdg-navigation-menu-list", className)} />;
}

export const NavigationMenuItem = RN.Item;

export function NavigationMenuTrigger({ className, ...props }: ComponentProps<typeof RN.Trigger>) {
  return <RN.Trigger {...props} className={cn("gdg-navigation-menu-trigger", className)} />;
}

export function NavigationMenuLink({ className, ...props }: ComponentProps<typeof RN.Link>) {
  return <RN.Link {...props} className={cn("gdg-navigation-menu-link", className)} />;
}

export function NavigationMenuContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RN.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RN.Content
      ref={motionRef}
      className={cn("gdg-navigation-menu-content", className)}
      {...props}
    />
  );
}

export function NavigationMenuViewport({
  className,
  ...props
}: ComponentProps<typeof RN.Viewport>) {
  return <RN.Viewport {...props} className={cn("gdg-navigation-menu-viewport", className)} />;
}

export function NavigationMenuIndicator({
  className,
  ...props
}: ComponentProps<typeof RN.Indicator>) {
  return <RN.Indicator {...props} className={cn("gdg-navigation-menu-indicator", className)} />;
}

export const NavigationMenuSub = RN.Sub;
