import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Text({
  className,
  tone = "default",
  size = "md",
  ...props
}: ComponentProps<"p"> & { tone?: "default" | "muted"; size?: "xs" | "sm" | "md" }) {
  return (
    <p
      {...props}
      className={cn("gdg-text", `gdg-text-${size}`, tone === "muted" && "gdg-muted", className)}
    />
  );
}
