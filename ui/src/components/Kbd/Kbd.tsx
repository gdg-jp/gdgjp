import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd {...props} className={cn("gdg-kbd", className)} />;
}

export function KbdGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-kbd-group", className)} />;
}
