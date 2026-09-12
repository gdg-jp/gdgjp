import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Heading({
  level = 2,
  className,
  ...props
}: ComponentProps<"h2"> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const Tag = `h${level}` as "h2";
  return <Tag {...props} className={cn("gdg-heading", className)} />;
}
