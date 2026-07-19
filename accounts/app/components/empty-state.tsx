import type { ComponentType, ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardHeader className="items-start sm:items-center sm:text-center">
        {Icon ? (
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </div>
        ) : null}
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription className="max-w-md">{description}</CardDescription> : null}
      </CardHeader>
      {action ? (
        <CardContent className="flex justify-start sm:justify-center">{action}</CardContent>
      ) : null}
    </Card>
  );
}
