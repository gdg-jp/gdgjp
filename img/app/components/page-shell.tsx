import type { ReactNode } from "react";
import { TopBar, type TopBarUser } from "~/components/top-bar";
import { cn } from "~/lib/utils";

export function PageShell({
  user,
  children,
  className,
  size = "md",
}: {
  user: TopBarUser | null;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const max = size === "sm" ? "max-w-xl" : size === "lg" ? "max-w-5xl" : "max-w-3xl";
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <TopBar user={user} />
      <main className={cn("motion-enter container mx-auto px-4 py-8", max, className)}>
        {children}
      </main>
    </div>
  );
}
