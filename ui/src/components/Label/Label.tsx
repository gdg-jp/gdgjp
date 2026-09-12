import { Label as RLabel } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Label({ className, ...props }: ComponentProps<typeof RLabel.Root>) {
  return <RLabel.Root {...props} className={cn("gdg-label", className)} />;
}
