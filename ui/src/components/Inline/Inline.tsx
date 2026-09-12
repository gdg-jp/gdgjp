import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Inline({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-inline", className)} />;
}
