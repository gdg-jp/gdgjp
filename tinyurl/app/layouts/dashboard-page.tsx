import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function DashboardPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6", className)}>
      {children}
    </div>
  );
}

export function DashboardPageHeader({
  title,
  description,
  titleAccessory,
  eyebrow,
  actions,
  actionsClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  titleAccessory?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  actionsClassName?: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-3">{eyebrow}</div> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{title}</h1>
          {titleAccessory}
        </div>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? (
        <div className={cn("flex w-full flex-wrap gap-2 sm:w-auto", actionsClassName)}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
