import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Empty({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-empty-component", className)} />;
}

export function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-empty-header", className)} />;
}

export function EmptyMedia({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-empty-media", className)} />;
}

export function EmptyTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 {...props} className={cn("gdg-empty-title", className)} />;
}

export function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p {...props} className={cn("gdg-empty-description", className)} />;
}

export function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-empty-content", className)} />;
}
