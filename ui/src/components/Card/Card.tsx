import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-card", className)} />;
}
