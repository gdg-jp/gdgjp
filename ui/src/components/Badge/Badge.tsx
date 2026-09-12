import type { ComponentProps } from "react";
import { cn } from "../../utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return <span {...props} className={cn("gdg-badge", `gdg-tone-${tone}`, className)} />;
}
