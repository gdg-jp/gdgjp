import { Separator as RSeparator } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Separator({ className, ...props }: ComponentProps<typeof RSeparator.Root>) {
  return <RSeparator.Root {...props} className={cn("gdg-separator", className)} />;
}
