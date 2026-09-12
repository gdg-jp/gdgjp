import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../utils";

export function SidebarNav({
  children,
  className,
  ...props
}: ComponentProps<"nav"> & { children?: ReactNode }) {
  return (
    <nav {...props} className={cn("gdg-sidebar-nav", className)}>
      {children}
    </nav>
  );
}
