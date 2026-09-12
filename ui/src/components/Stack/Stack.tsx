import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Stack({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-stack", className)} />;
}
