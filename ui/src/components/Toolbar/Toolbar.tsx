import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-toolbar", className)} />;
}
