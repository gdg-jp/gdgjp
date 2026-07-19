import type { ReactNode } from "react";
import type { TopBarUser } from "~/components/top-bar";
import { cn } from "~/lib/utils";

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
  const max = size === "sm" ? "max-w-xl" : size === "lg" ? "max-w-none" : "max-w-3xl";
  return <div className={cn("mx-auto w-full", max, className)}>{children}</div>;
}
