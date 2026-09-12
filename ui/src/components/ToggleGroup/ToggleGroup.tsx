import { ToggleGroup as RToggleGroup } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function ToggleGroup({ className, ...props }: ComponentProps<typeof RToggleGroup.Root>) {
  return <RToggleGroup.Root {...props} className={cn("gdg-toggle-group", className)} />;
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof RToggleGroup.Item>) {
  return <RToggleGroup.Item {...props} className={cn("gdg-toggle-group-item", className)} />;
}
