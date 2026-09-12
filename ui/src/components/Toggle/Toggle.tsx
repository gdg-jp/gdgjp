import { Toggle as RToggle } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Toggle({ className, ...props }: ComponentProps<typeof RToggle.Root>) {
  return <RToggle.Root {...props} className={cn("gdg-toggle", className)} />;
}
