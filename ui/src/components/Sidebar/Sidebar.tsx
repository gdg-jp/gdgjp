import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Slot } from "radix-ui";
import { type ComponentProps, type ReactNode, createContext, useContext, useState } from "react";
import { cn } from "../../utils";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

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
}: ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle: () => setOpen(!open) }}>
      <div
        {...props}
        data-state={open ? "expanded" : "collapsed"}
        className={cn("gdg-sidebar-provider", className)}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "icon",
  className,
  ...props
}: ComponentProps<"aside"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
}) {
  const context = useSidebar();
  return (
    <aside
      {...props}
      data-side={side}
      data-variant={variant}
      data-collapsible={collapsible}
      data-state={collapsible === "none" || context.open ? "expanded" : "collapsed"}
      className={cn("gdg-sidebar-component", className)}
    />
  );
}

export function SidebarTrigger({ className, children, ...props }: ComponentProps<"button">) {
  const context = useSidebar();
  const Icon = context.open ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      aria-expanded={context.open}
      aria-label={props["aria-label"] ?? (context.open ? "サイドバーを閉じる" : "サイドバーを開く")}
      data-state={context.open ? "open" : "closed"}
      className={cn("gdg-sidebar-trigger", className)}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) context.toggle();
      }}
    >
      {children ?? <Icon size={18} aria-hidden="true" />}
    </button>
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-sidebar-header", className)} />;
}

export function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-sidebar-footer", className)} />;
}

export function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-sidebar-content", className)} />;
}

export function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-sidebar-group", className)} />;
}

export function SidebarGroupLabel({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-sidebar-group-label", className)} />;
}

export function SidebarGroupContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-sidebar-group-content", className)} />;
}

export function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return <ul {...props} className={cn("gdg-sidebar-menu", className)} />;
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return <li {...props} className={cn("gdg-sidebar-menu-item", className)} />;
}

export function SidebarMenuButton({
  asChild,
  isActive,
  className,
  ...props
}: ComponentProps<"button"> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      {...props}
      {...(!asChild ? { type: props.type ?? "button" } : {})}
      data-active={isActive || undefined}
      className={cn("gdg-sidebar-menu-button", className)}
    />
  );
}

export function SidebarRail({ className, ...props }: ComponentProps<"button">) {
  const context = useSidebar();
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      aria-label={props["aria-label"] ?? "サイドバーを切り替え"}
      className={cn("gdg-sidebar-rail", className)}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) context.toggle();
      }}
    />
  );
}

export function SidebarInset({ className, ...props }: ComponentProps<"main">) {
  return <main {...props} className={cn("gdg-sidebar-inset", className)} />;
}

export function SidebarMenuBadge({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn("gdg-sidebar-menu-badge", className)} />;
}

export function SidebarMenuAction({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={cn("gdg-sidebar-menu-action", className)}
    />
  );
}

export type SidebarProviderProps = { children: ReactNode; open?: boolean; defaultOpen?: boolean };
