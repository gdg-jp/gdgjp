import { Tabs as RTabs } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export const Tabs = RTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RTabs.List>) {
  return <RTabs.List {...props} className={cn("gdg-tabs-list", className)} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RTabs.Trigger>) {
  return <RTabs.Trigger {...props} className={cn("gdg-tabs-trigger", className)} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RTabs.Content>) {
  return <RTabs.Content {...props} className={cn("gdg-tabs-content", className)} />;
}
