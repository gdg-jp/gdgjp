import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Slot } from "radix-ui";
import { createContext, useContext, useState } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
const SidebarContext = createContext(null);
export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used inside SidebarProvider");
  return context;
}
export function SidebarProvider({
  open: controlledOpen,
  defaultOpen = true,
  onOpenChange,
  className,
  children,
  ...props
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return _jsx(SidebarContext.Provider, {
    value: { open, setOpen, toggle: () => setOpen(!open) },
    children: _jsx("div", {
      ...props,
      "data-state": open ? "expanded" : "collapsed",
      className: cn("gdg-sidebar-provider", className),
      children: children,
    }),
  });
}
export function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "icon",
  className,
  ...props
}) {
  const context = useSidebar();
  return _jsx("aside", {
    ...props,
    "data-side": side,
    "data-variant": variant,
    "data-collapsible": collapsible,
    "data-state": collapsible === "none" || context.open ? "expanded" : "collapsed",
    className: cn("gdg-sidebar-component", className),
  });
}
export function SidebarTrigger({ className, children, ...props }) {
  const context = useSidebar();
  const Icon = context.open ? PanelLeftClose : PanelLeftOpen;
  return _jsx("button", {
    ...props,
    type: props.type ?? "button",
    "aria-expanded": context.open,
    "aria-label": props["aria-label"] ?? (context.open ? "サイドバーを閉じる" : "サイドバーを開く"),
    "data-state": context.open ? "open" : "closed",
    className: cn("gdg-sidebar-trigger", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.toggle();
    },
    children: children ?? _jsx(Icon, { size: 18, "aria-hidden": "true" }),
  });
}
export function SidebarHeader({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-sidebar-header", className) });
}
export function SidebarFooter({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-sidebar-footer", className) });
}
export function SidebarContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-sidebar-content", className) });
}
export function SidebarGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-sidebar-group", className) });
}
export function SidebarGroupLabel({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-sidebar-group-label", className) });
}
export function SidebarGroupContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-sidebar-group-content", className) });
}
export function SidebarMenu({ className, ...props }) {
  return _jsx("ul", { ...props, className: cn("gdg-sidebar-menu", className) });
}
export function SidebarMenuItem({ className, ...props }) {
  return _jsx("li", { ...props, className: cn("gdg-sidebar-menu-item", className) });
}
export function SidebarMenuButton({ asChild, isActive, className, ...props }) {
  const Comp = asChild ? Slot.Root : "button";
  return _jsx(Comp, {
    ...props,
    ...(!asChild ? { type: props.type ?? "button" } : {}),
    "data-active": isActive || undefined,
    className: cn("gdg-sidebar-menu-button", className),
  });
}
export function SidebarRail({ className, ...props }) {
  const context = useSidebar();
  return _jsx("button", {
    ...props,
    type: props.type ?? "button",
    "aria-label": props["aria-label"] ?? "サイドバーを切り替え",
    className: cn("gdg-sidebar-rail", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.toggle();
    },
  });
}
export function SidebarInset({ className, ...props }) {
  return _jsx("main", { ...props, className: cn("gdg-sidebar-inset", className) });
}
export function SidebarMenuBadge({ className, ...props }) {
  return _jsx("span", { ...props, className: cn("gdg-sidebar-menu-badge", className) });
}
export function SidebarMenuAction({ className, ...props }) {
  return _jsx("button", {
    ...props,
    type: props.type ?? "button",
    className: cn("gdg-sidebar-menu-action", className),
  });
}
