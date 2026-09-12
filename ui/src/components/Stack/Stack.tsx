import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Stack({
  align,
  className,
  ...props
}: ComponentProps<"div"> & { align?: "stretch" | "start" | "center" | "end" }) {
  return <div {...props} data-align={align} className={cn("gdg-stack", className)} />;
}
