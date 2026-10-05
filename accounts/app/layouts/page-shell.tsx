import { cn } from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import type { TopBarUser } from "~/layouts/top-bar";

type PageShellProps = {
  /**
   * Kept while feature routes migrate to the authenticated layout. The account
   * shell owns the global user menu and navigation now.
   */
  user?: TopBarUser | null;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
};

export function PageShell({ children, className, size = "md" }: PageShellProps) {
  const location = useLocation();
  const max = size === "sm" ? "max-w-xl" : size === "lg" ? "max-w-7xl" : "max-w-3xl";
  return (
    <div
      className={cn(location.key !== "default" && "route-enter", "mx-auto w-full", max, className)}
    >
      {children}
    </div>
  );
}
