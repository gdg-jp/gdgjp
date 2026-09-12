import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden="true" {...props} className={cn("gdg-skeleton", className)} />;
}
